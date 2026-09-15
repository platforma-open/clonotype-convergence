---
"@platforma-open/milaboratories.clonotype-convergence.ui": patch
"@platforma-open/milaboratories.clonotype-convergence": patch
---

MILAB-6650: render "Convergence expected at" and its values as one joined control

The metadata column and its value picker were two separate dropdowns with a 6px
gap. They now read as a single control the way the table filters do: the column
dropdown takes `group-position="top"`, the value multiselect `group-position="bottom"`
(both PlDropdown and PlDropdownMulti expose the prop — it squares off the
adjoining corners), and the wrapper's gap is removed so the borders meet.

The lower dropdown loses its "Selected values" label, as the joined form
intends, and carries no placeholder. It is also pulled up 1px
(`margin-top: -1px`) so the two adjoining 1px borders overlap into a single
line instead of stacking into a 2px seam.
