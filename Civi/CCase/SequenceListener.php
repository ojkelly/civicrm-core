<?php
namespace Civi\CCase;

/**
 * The sequence-listener looks for CiviCase XML tags with "<sequence>". If
 * a change is made to any record in case-type which uses "<sequence>", then
 * it attempts to add the next step in the sequence.
 */
class SequenceListener implements CaseChangeListener {

  /**
   * @var SequenceListener
   */
  private static $singleton;

  /**
   * @param bool $reset
   *   Whether to forcibly rebuild the entire container.
   * @return \Symfony\Component\DependencyInjection\TaggedContainerInterface
   */
  public static function singleton($reset = FALSE) {
    if ($reset || self::$singleton === NULL) {
      self::$singleton = new SequenceListener();
    }
    return self::$singleton;
  }

  public static function onCaseChange_static(\Civi\CCase\Event\CaseChangeEvent $event) {
    self::singleton()->onCaseChange($event);
  }

  public function onCaseChange(\Civi\CCase\Event\CaseChangeEvent $event) {
    /** @var \Civi\CCase\Analyzer $analyzer */
    $analyzer = $event->analyzer;

    $activitySetXML = $this->getSequenceXml($analyzer->getXml());
    if (!$activitySetXML) {
      return;
    }

    $actTypes = array_flip(\CRM_Core_PseudoConstant::activityType(TRUE, TRUE, FALSE, 'name'));
    $actStatuses = array_flip(\CRM_Core_PseudoConstant::activityStatus('name'));

    $actIndex = $analyzer->getActivityIndex(array('activity_type_id', 'status_id'));

    foreach ($activitySetXML->ActivityTypes->ActivityType as $actTypeXML) {
      $actTypeId = $actTypes[(string) $actTypeXML->name];
      if (empty($actIndex[$actTypeId])) {
        // Haven't tried this step yet!
        $this->createActivity($analyzer, $actTypeXML);
        return;
      }
      elseif (empty($actIndex[$actTypeId][$actStatuses['Completed']])) {
        // Haven't gotten past this step yet!
        return;
      }
    }

    // OK, the activity has completed every step in the sequence!
    civicrm_api3('Case', 'create', array(
      'id' => $analyzer->getCaseId(),
      'status_id' => 'Closed',
    ));
    $analyzer->flush();
  }

  /**
   * Find the ActivitySet which defines the pipeline.
   *
   * @param \SimpleXMLElement $xml
   * @return \SimpleXMLElement|NULL
   */
  public function getSequenceXml($xml) {
    if ($xml->ActivitySets && $xml->ActivitySets->ActivitySet) {
      foreach ($xml->ActivitySets->ActivitySet as $activitySetXML) {
        $seq = (string) $activitySetXML->sequence;
        if ($seq && strtolower($seq) == 'true') {
          if ($activitySetXML->ActivityTypes && $activitySetXML->ActivityTypes->ActivityType) {
            return $activitySetXML;
          }
          else {
            return NULL;
          }
        }
      }
    }
    return NULL;
  }

  /**
   * @param Analyzer $analyzer
   *   The case being analyzed -- to which we want to add an activity.
   * @param \SimpleXMLElement $actXML the <ActivityType> tag which describes the new activity
   */
  public function createActivity(Analyzer $analyzer, \SimpleXMLElement $actXML) {
    $params = array(
      'activity_type_id' => (string) $actXML->name,
      'status_id' => 'Scheduled',
      'activity_date_time' => \CRM_Utils_Time::getTime('YmdHis'),
      'case_id' => $analyzer->getCaseId(),
    );
    $r = civicrm_api3('Activity', 'create', $params);
    $analyzer->flush();
  }

}
