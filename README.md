# Clonotype Convergence

Find B-cell receptors that independent lineages converged on. This Platforma block implements the STAR statistic: for each clonotype it counts how many other CDR3s in the same sample differ by exactly one amino acid, then calls statistically significant convergence — a hallmark of antigen-driven selection, and a way to identify likely antigen-specific BCRs from repertoire data alone.

Open-source analysis block for Platforma, the biologics discovery platform by MiLaboratories. For the full no-code workflow, see [platforma.bio](https://platforma.bio/).

> **In-vivo BCR repertoires only.** In-vitro data — scFv libraries, phage or yeast display, panning-enriched repertoires — produces uninterpretable results. The algorithm still runs and emits numbers, but the signal it detects (germinal-center convergence under antigen-driven selection) does not exist in vitro.

## What it does

When an antigen drives selection, unrelated B-cell lineages arrive at similar CDR3 solutions independently. That convergence leaves a statistical trace: a clonotype whose CDR3 has an unusual number of near-identical neighbors in the same repertoire is more likely to be antigen-specific than one sitting alone in sequence space.

The block measures that neighbor density — how many other CDR3s in the sample are exactly one amino acid away — and then decides which densities are surprising. There are two ways it does so:

* **full-STAR**, the primary path, tests each clonotype against a null model of what neighbor density to expect by chance. That null comes from the clonotype's **generation probability** (Pgen) — how likely V(D)J recombination is to produce that CDR3 at all — supplied by the [Generation Probability](https://github.com/platforma-open/generation-probability) block upstream. The result is a Poisson-tail p-value per clonotype, with hits selected under Benjamini–Hochberg FDR control at a target alpha (0.005 by default). Clonotypes without a Pgen cannot be tested; they are excluded from the FDR set rather than counted against it, and reported as not hit.
* **fast-STAR** is the fallback when no Pgen is available. It calls hits from a neighbor-frequency threshold you set per chain. Simpler, no upstream dependency, and no formal error control — the block tells you explicitly when it has fallen back to this path.

Hits come with a **starScore** derived from the p-value, so candidates can be ranked rather than only split into hit and not-hit.

### Cross-sample reproducibility

Convergence in one sample can be noise. If your study has independent units — several donors, several animals — nominate the metadata column that identifies them and the block requires a clonotype to be a hit in more than one unit before it counts, and folds that reproducibility into starScore. The balance between raw signal strength and cross-unit support is controlled by a weight (0.5 by default). You can also mark which samples convergence is biologically *expected* in, so the analysis is anchored on the arm where selection should have happened.

### Additional controls

A minimum unique-CDR3 count per sample excludes samples too shallow to support the statistic; the block reports which samples were skipped and why. An optional cluster filter adds a stricter call, flagging a clonotype only when several one-edit-distance CDR3s form a cluster of at least a minimum size — matching the source paper's headline binder definition. It is off by default.

Results are explored as a main table, a score distribution, a per-sample table, and a per-sample distribution.

## Inputs & outputs

* **Input:** clonotype-level BCR data with CDR3 amino acid sequence, CDR3 nucleotide sequence, and per-clonotype abundance — bulk heavy, bulk light, or single-cell IG. Light-chain analysis on single-cell data is an explicit opt-in. For the full-STAR path, a per-clonotype Pgen column from [Generation Probability](https://github.com/platforma-open/generation-probability). TCR datasets are not offered.
* **Output:** per clonotype and chain — neighbor count, neighbor frequency, a p-value and starScore on the full-STAR path, and a Hit / Not hit call; optionally a stricter cluster-filtered call. All exposed as columns for downstream filtering and ranking.

## Specifications

| | |
|---|---|
| Block title in app | Clonotype Convergence |
| Method | STAR — one-amino-acid-neighbor density among CDR3s within a sample |
| Hit calling | full-STAR (Pgen-based null, Benjamini–Hochberg FDR, default alpha 0.005) when Pgen is available; fast-STAR neighbor-frequency threshold otherwise |
| Data types | Bulk heavy, bulk light, single-cell IG — BCR only, TCR filtered out |
| Reproducibility | Optional grouping column (e.g. donor) requiring hits in multiple independent units, folded into starScore with a configurable weight (default 0.5) |
| Expected-sample filter | Optional metadata column and values marking where convergence is biologically expected |
| Sample floor | Minimum unique CDR3 count per sample; skipped samples reported |
| Cluster filter | Optional stricter binder call requiring a cluster of at least a minimum size; off by default |
| Views | Main table, score distribution, per-sample table, per-sample distribution |

## Use cases

* **Antigen-specific BCR discovery:** identify likely antigen-specific receptors from repertoire sequencing alone, without antigen-labeled sorting.
* **Post-immunization repertoires:** find the clonotypes that responded, by the convergence signature immunization leaves.
* **Infection and vaccine response:** detect convergent lineages in a response where the target is known but the binders are not.
* **Prioritizing for expression:** rank candidates by starScore before committing to synthesis and testing.
* **Cross-donor validation:** require convergence to reproduce across donors, so single-sample noise does not reach the shortlist.
* **Stricter binder calls:** enable the cluster filter to reproduce the source paper's binder definition when you want the most conservative set.

## FAQ

### What is clonotype convergence, and why does it indicate antigen specificity?

Antigen-driven selection pushes independent B-cell lineages toward similar solutions, so an antigen-specific CDR3 tends to have near-identical neighbors that arose separately. A clonotype with many one-amino-acid neighbors in the same repertoire is therefore more likely to have been selected for binding than one that is isolated in sequence space.

### What is the difference between full-STAR and fast-STAR?

full-STAR tests each clonotype against a null model built from its generation probability and controls the false discovery rate across the sample, so a hit means statistically significant convergence. fast-STAR just applies a neighbor-frequency threshold — usable without any upstream dependency, but with no error control, so the threshold is a judgment call rather than a significance level.

### Do I need the Generation Probability block?

For full-STAR, yes. Without a per-clonotype Pgen there is no null model, and the block falls back to fast-STAR thresholds. Since full-STAR is the primary and better-calibrated path, running Generation Probability upstream is recommended. The block reports when full-STAR was not computed for a chain, so you always know which path produced your results.

### Why can't I use this on my display library?

Because the signal does not exist there. STAR detects convergence produced by germinal-center selection in vivo. In a synthetic or panning-enriched library, sequence neighborhoods reflect library design and amplification, not independent lineages converging under antigen pressure. The numbers will compute and mean nothing.

### Does it work on TCRs?

No. The method and its validation are for BCR repertoires, and TCR datasets are filtered out of the input picker.

### What does the grouping column do?

It tells the block which samples are independent units — typically donors or animals. With it set, a clonotype must be a hit in more than one unit to count, and cross-unit support becomes part of starScore. This is the strongest available guard against single-sample false positives.

### What is the cluster filter for?

A stricter definition of a binder: rather than flagging a clonotype on neighbor density alone, it requires several one-edit-distance CDR3s to form a cluster of at least the size you set. That matches the headline definition in the source paper, and gives a smaller, more conservative candidate set. It is off by default.

### Why were some of my samples skipped?

Either they fell below the minimum unique-CDR3 count — the statistic is not meaningful in a shallow sample — or they carried no usable CDR3 sequences. Both cases are reported with the sample count so nothing disappears silently.

## Citation

The STAR method is from the Statistical Biophysics group. If you use this block in your research, please cite:

> Abbate, M. F., Dupic, T., Vigne, E., Shahsavarian, M. A., Walczak, A. M., & Mora, T. (2024). Computational detection of antigen-specific B cell receptors following immunization. *PNAS* **121**(35), e2401058121. [https://doi.org/10.1073/pnas.2401058121](https://doi.org/10.1073/pnas.2401058121)

## Part of the Platforma ecosystem

This block is part of [Platforma](https://platforma.bio/) by [MiLaboratories](https://github.com/milaboratory), implementing the STAR statistic from [statbiophys/STAR](https://github.com/statbiophys/STAR). Explore the other open-source blocks at [github.com/platforma-open](https://github.com/platforma-open) and the docs for V(D)J analysis at [docs.platforma.bio/biology-guides/vdj-analysis](https://docs.platforma.bio/biology-guides/vdj-analysis/).
