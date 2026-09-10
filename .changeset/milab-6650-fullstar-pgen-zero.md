---
"@platforma-open/milaboratories.clonotype-convergence.software": patch
"@platforma-open/milaboratories.clonotype-convergence.workflow": patch
"@platforma-open/milaboratories.clonotype-convergence": patch
---

MILAB-6650: full-STAR — include Pgen==0 clones and bound fullStarScore

- Pgen==0 is a valid null (Lambda=0 → rate 0.2 via the pseudocount), so those
  clones are now tested rather than dropped to "Not hit" — they are the strongest
  convergent hits. Only NaN Pgen (OLGA could not compute one) stays untestable.
- fullStarScore = -log10(Pvalue) is now derived in full_star.py with a per-sample
  floor at the smallest positive Pvalue, so the strongest / underflowed clones get
  a finite, on-scale score instead of +inf; the workflow passes it through instead
  of recomputing. Raw Pvalue is unchanged, so M1 reproduction is unaffected.
