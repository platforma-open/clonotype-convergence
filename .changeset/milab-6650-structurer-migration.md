---
"@platforma-open/milaboratories.clonotype-convergence.workflow": patch
"@platforma-open/milaboratories.clonotype-convergence.model": patch
"@platforma-open/milaboratories.clonotype-convergence.ui": patch
---

MILAB-6650: migrate onto the structurer + full SDK upgrade

The block now uses the canonical `block-tools structure` layout, so its
tsconfig, lint/format config, turbo tasks and package manifests are
tool-managed and refreshable, and `pnpm run upgrade-sdk` drives future SDK
upgrades in one step.

Carried the SDK forward with it (the require-latest gate makes this
inseparable from the migration): block-tools 2.12.13, model/ui-vue 1.81.1,
test 1.81.2, workflow-tengo 6.8.2, tengo-builder 4.0.22.

`block/` is now the slim published facade exporting
`ClonotypeConvergenceBlockPointer`; the model, ui and workflow packages
become private and ship inside it. Consumers that referenced the old
`blockSpec` export should use the pointer instead.

The model's tables were ported to the SDK 1.81 column API — discovery
returns a primary/secondary recipe split, and table visibility is expressed
as declarative column selectors rather than spec predicates. Table contents
and the per-chain fast-STAR hiding behave as before.
