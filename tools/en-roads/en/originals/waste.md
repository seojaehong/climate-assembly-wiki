---
title: Waste and Leakage
source_url: https://docs.climateinteractive.org/projects/en-roads/en/latest/guide/waste.html
source: En-ROADS User Guide (Climate Interactive)
license: CC BY 4.0
fetched_at: 2026-05-31
trust_label: author-verified
---

# Waste and Leakage

Change adoption of emissions best practices for waste, energy, industry. Reduce CH4 / N2O from landfills, wastewater, fossil fuel leaks, fertilizer production; manage F-gases (HFCs, PFCs, SF6).

## Examples

**Methane leakage from energy systems**
- Leak detection (drones, satellites); pump/valve upgrades
- Methane recovery, power gen, flaring instead of venting

**CH4/N2O from waste**
- Waste reduction policies
- Landfill methane capture
- Oxygen control in wastewater treatment

**N2O from industry**
- Removal during manufacturing (N2O → N2 + O2)

**F-gases**
- Refrigerant recycling, alternative refrigerants (CO2, propane, isobutane)
- End-of-life destruction

## Big Messages
- Improved practices substantially cut CH4, N2O, F-gases
- These gases have higher heat-trapping potential than CO2 per unit weight — powerful mitigation lever

## Key Dynamics
- **Diffusion**: time to develop, improve, implement best practices
- **Capital stock turnover**: time to retire higher-emitting infrastructure
- **Scale and intensity**: reduce production scale OR emissions intensity

## Co-Benefits
- Methane leak reduction = savings
- Composting → nutrient-rich soil amendments
- N2O is now the biggest ozone-depleting emission — reducing it helps the ozone layer

## Equity
- New practices add costs to consumer goods
- F-gas alternatives may have flammability/toxicity concerns

## Slider Settings

| Setting | % of potential reduction |
|---------|--------------------------|
| Highly reduced | 100% to 70% |
| Reduced | 70% to 20% |
| Status quo | 20% to 0% |
| Increased | 0% to -10% |

For **industry N2O**: max = 95% reduction from 1990 (Jörß et al. 2023). For **F-gases**: default ~90% reduction of F-gas intensities.

Note: 100% slider movement is not a 100% total emissions reduction — some emissions are unavoidable.

## Model Structure
En-ROADS calculates methane intensity of energy (kt CH4 / EJ). Reductions via retrofits, replacement, practice change, monitoring. ~10% of fossil-fuel methane and 100% of bioenergy methane comes from incomplete combustion — only reduced by not burning. Each GHG modeled separately (no GWP conversion internally; GWP100 used only for CO2e display).
