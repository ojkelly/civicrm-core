<?php

/**
 * Create DAO ORM classes.
 */
class CRM_Core_CodeGen_Entity extends CRM_Core_CodeGen_BaseTask {
  function run() {
    $this->generateEntitys();
  }

  function generateEntitys() {
    foreach (array_keys($this->tables) as $name) {
      echo "Generating $name as " . $this->tables[$name]['fileName'] . "\n";

      if (empty($this->tables[$name]['base'])) {
        echo "No base defined for $name, skipping output generation\n";
        continue;
      }

      $template = new CRM_Core_CodeGen_Util_Template('php');
      $template->assign('table', $this->tables[$name]);

      $directory = $this->config->phpCodePath . $this->tables[$name]['base'];
      CRM_Core_CodeGen_Util_File::createDir($directory);

      $template->run('entity.tpl', $directory . $this->tables[$name]['fileName']);
    }
  }
}