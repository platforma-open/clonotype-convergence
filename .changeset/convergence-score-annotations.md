---
'@platforma-open/milaboratories.clonotype-convergence.workflow': patch
---

Annotate the exported convergence columns as scores so lead selection can use
them in its defaults. Convergent neighbour frequency (`nbFreq`) gets
`pl7.app/isScore` + `pl7.app/score/rankingOrder: decreasing`, making it a
discoverable, rankable score. Convergent hit (`fastStar`) gets `pl7.app/isScore`
+ `pl7.app/score/defaultCutoff: ["Hit"]`, so it can serve as a default
"keep only hits" filter (`string_in` via its existing discrete-value
annotations). Both annotations propagate to the single-sample export family.
Lead selection adds these to its in-vivo preset separately, in that block.
