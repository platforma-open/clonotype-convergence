---
"@platforma-open/milaboratories.clonotype-convergence": minor
"@platforma-open/milaboratories.clonotype-convergence.model": minor
"@platforma-open/milaboratories.clonotype-convergence.ui": minor
"@platforma-open/milaboratories.clonotype-convergence.workflow": minor
"@platforma-open/milaboratories.clonotype-convergence.kind": minor
---

Add a "Keep isotypes" filter: only clonotypes of the selected heavy-chain isotypes are analyzed (IgM and IgG in a new block). Other clonotypes, including those of unknown isotype (blank, or MiXCR's "cant_distinguish"), are removed before neighbours are counted; an empty selection keeps every clonotype. On single-cell data the heavy chain's isotype applies to both chains. Offered when the dataset has an isotype column; blocks created before this keep every isotype. Optionally, "Also score against each kept isotype" adds a score and hit per kept isotype (fast-STAR, and full-STAR where Pgen is available): each clone's convergence measured among that isotype's CDR3s only, under new column names (`pl7.app/vdj/convergence/isotype/*`, isotype in the domain), so the main columns are unchanged.
