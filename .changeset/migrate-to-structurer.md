---
'@platforma-open/milaboratories.clonotype-convergence.model': minor
'@platforma-open/milaboratories.clonotype-convergence': minor
'@platforma-open/milaboratories.clonotype-convergence.ui': patch
'@platforma-open/milaboratories.clonotype-convergence.workflow': patch
'@platforma-open/milaboratories.clonotype-convergence.software': patch
---

Migrate onto the structurer and take the full SDK upgrade (block-tools 2.14.3, tengo-builder 4.0.23, model 1.83.0, ui-vue 1.83.3), porting the model onto the 1.83 column-discovery and column-selector APIs.

Adds the mandatory block kind. Its init-params contract is the dataset pick plus every analysis setting, so a project template can seed a fully configured Clonotype Convergence block.
