<?php
namespace Civi\Core;
use Doctrine\Common\Annotations\AnnotationReader;
use Doctrine\Common\Annotations\AnnotationRegistry;
use Doctrine\Common\Annotations\FileCacheReader;
use Doctrine\Common\Cache\FilesystemCache;
use Doctrine\ORM\EntityManager;
use Doctrine\ORM\Mapping\Driver\AnnotationDriver;
use Doctrine\ORM\Tools\Setup;
use Symfony\Component\DependencyInjection\ContainerBuilder;
use Symfony\Component\DependencyInjection\Definition;
use Symfony\Component\DependencyInjection\Reference;

// TODO use Symfony\Component\DependencyInjection\Loader\YamlFileLoader;

class Container {

  const SELF = 'civi_container_factory';

  /**
   * @var ContainerBuilder
   */
  private static $singleton;

  /**
   * @return \Symfony\Component\DependencyInjection\TaggedContainerInterface
   */
  public static function singleton() {
    if (self::$singleton === NULL) {
      $c = new self();
      self::$singleton = $c->createContainer();
    }
    return self::$singleton;
  }

  /**
   * @var ContainerBuilder
   */
  public function createContainer() {
    $civicrm_base_path = dirname(dirname(__DIR__));
    $container = new ContainerBuilder();
    $container->setParameter('civicrm_base_path', $civicrm_base_path);
    $container->setParameter('cache_dir', \CRM_Utils_Path::join(dirname(CIVICRM_TEMPLATE_COMPILEDIR), 'cache'));
    $container->set(self::SELF, $this);

// TODO Move configuration to an external file; define caching structure
//    if (empty($configDirectories)) {
//      throw new \Exception(__CLASS__ . ': Missing required properties (civicrmRoot, configDirectories)');
//    }
//    $locator = new FileLocator($configDirectories);
//    $loaderResolver = new LoaderResolver(array(
//      new YamlFileLoader($container, $locator)
//    ));
//    $delegatingLoader = new DelegatingLoader($loaderResolver);
//    foreach (array('services.yml') as $file) {
//      $yamlUserFiles = $locator->locate($file, NULL, FALSE);
//      foreach ($yamlUserFiles as $file) {
//        $delegatingLoader->load($file);
//      }
//    }

    $container->setDefinition('annotation_driver', new Definition(
      '\Doctrine\ORM\Mapping\Driver\AnnotationDriver',
      array('%civicrm_base_path%', '%cache_dir%/cache/annotations')
    ))
      ->setFactoryService(self::SELF)->setFactoryMethod('createAnnotationDriver');

    $container->setDefinition('doctrine_configuration', new Definition(
      '\Doctrine\ORM\Configuration',
      array(new Reference('annotation_driver'))
    ))
      ->setFactoryService(self::SELF)->setFactoryMethod('createDoctrineConfiguration');

    $container->setDefinition('entity_manager', new Definition(
      '\Doctrine\ORM\EntityManager',
      array(new Reference('doctrine_configuration'))
    ))
      ->setFactoryService(self::SELF)->setFactoryMethod('createEntityManager');

    return $container;
  }

  /**
   * @param string $civicrm_base_path
   * @param string $annotation_cache_path
   * @return \Doctrine\ORM\Mapping\Driver\AnnotationDriver
   */
  public function createAnnotationDriver($civicrm_base_path, $annotation_cache_path) {
    \CRM_Utils_Path::mkdir_p_if_not_exists($annotation_cache_path);

    $doctrine_annotations_path = \CRM_Utils_Path::join($civicrm_base_path, 'vendor', 'doctrine', 'orm', 'lib', 'Doctrine', 'ORM', 'Mapping', 'Driver', 'DoctrineAnnotations.php');
    AnnotationRegistry::registerFile($doctrine_annotations_path);
    $annotation_reader = new AnnotationReader();
    $file_cache_reader = new FileCacheReader($annotation_reader, $annotation_cache_path, TRUE);
    $metadata_path = \CRM_Utils_Path::join($civicrm_base_path, 'Civi');
    $driver = new AnnotationDriver($file_cache_reader, $metadata_path);

    return $driver;
  }

  /**
   * @param \Doctrine\ORM\Mapping\Driver\AnnotationDriver $driver
   * @return \Doctrine\ORM\Configuration
   */
  public function createDoctrineConfiguration($driver) {
    // FIXME Doesn't seem like a good idea to use filesystem as the query cache
//    $doctrine_cache_path = \CRM_Utils_Path::join(dirname(CIVICRM_TEMPLATE_COMPILEDIR), 'cache', 'doctrine');
//    \CRM_Utils_Path::mkdir_p_if_not_exists($doctrine_cache_path);
//    $doctrine_cache = new FilesystemCache($doctrine_cache_path);
    $doctrine_cache = NULL;

    $config = Setup::createConfiguration(TRUE, NULL, $doctrine_cache);
    $config->setMetadataDriverImpl($driver);

    return $config;
  }

  /**
   * @param \Doctrine\ORM\Configuration $config
   * @return \Doctrine\ORM\EntityManager
   */
  public function createEntityManager($config) {
    $dbSettings = new \CRM_DB_Settings();
    $em = EntityManager::create($dbSettings->toDoctrineArray(), $config);
    return $em;
  }
}