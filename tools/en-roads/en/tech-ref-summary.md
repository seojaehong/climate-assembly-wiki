---
title: En-ROADS Technical Reference — Chapter Summaries
source: En-ROADS Technical Reference (Climate Interactive, May 2026)
source_file: 00_입력자료/공식자료집/En-ROADS_Technical_Reference.pdf
license: CC BY 4.0
fetched_at: 2026-05-31
trust_label: author-verified
authors: Siegel L.S., Campbell C., Chikofsky J., Delibas A., Dianati K., Eker S., Fiddaman T., Franck T., Gaafar K., Homer J., Jones A.P., Jones C., Loughman J., McCauley S., Sawin E., Soderquist C., Sterman J.
---

# En-ROADS Technical Reference — Chapter Summaries

The Technical Reference (131 pp., May 2026) documents the equations, calibration, and assumptions behind the En-ROADS simulator. It is a system-dynamics model — globally aggregated, integrating energy, land use, economy, and climate — designed to return results in seconds and remain transparent to policymakers and general audiences. Below is a one-to-two paragraph summary of each main section. See the source PDF for full equations.

## 1. Introduction

En-ROADS is a globally aggregated simple climate model designed for accessibility and speed (results in seconds). It complements larger disaggregated tools such as integrated assessment models (IAMs) and general circulation climate models, which are used to calibrate En-ROADS. The model spans energy demand and supply, land use and forestry, biosphere carbon, emissions of CO2/CH4/N2O/F-gases, carbon dioxide removal, well-mixed GHG cycles, climate response, ocean systems, GDP damage, and other impacts.

## 2. Model Structure

The structural diagram links demand (population, GDP per capita, energy intensity per sector — transport, buildings, industry) to supply (carbon intensity by source, learning effects, R&D, complementary assets, resource limits, CCS for Coal/Gas/Bio). Outputs feed into emissions → GHG concentrations → radiative forcing → temperature → impacts → feedback to GDP and crop yield. Sectoral granularity is moderate: electric vs non-electric energy, vintages for capital stock turnover.

## 3. Demand

Demand for energy services arises from population, GDP per capita, and behavioral preferences (diet, transport mode, food waste). Energy intensity of services is tracked separately for transport, buildings, and industry, with stock vintages capturing retrofits, efficiency improvements, and equipment retirement. Demand responds endogenously to price (taxes, subsidies, carbon price) via standard elasticities. Food demand drives farmland needs and bioenergy harvest separately.

## 4. Supply

Each primary energy source (coal, oil, gas, bioenergy, renewables, nuclear, new zero-carbon) is modeled with capacity stages: under development → construction → operation → retirement. Marginal costs combine capital, fuel, operating, and tax/subsidy components. Learning-by-doing reduces unit costs at the source's progress ratio (e.g., renewables ≈ 0.80 vs coal ≈ 0.98). Resource availability constrains long-run extraction. CCS is modeled as an add-on for Coal/Gas/Bioenergy.

## 5. Market Clearing and Utilization

Energy sources compete to meet demand, allocated by relative marginal cost with stickiness from existing capital. "Crowding out" emerges: subsidizing one zero-carbon source reduces deployment of others. "Squeezing the balloon" emerges: discouraging one fossil source can raise demand for others unless multiple are restricted or carbon-priced. Utilization rates of existing capacity adjust to economic conditions.

## 6. Land Use, Land Use Change, and Forestry (LULUCF)

Tracks farmland, mature forest, regrowing forest, degraded forest, and other land. Agricultural expansion driven by food and bioenergy demand; deforestation and degradation release carbon. Higher crop yields reduce pressure for land expansion. Afforestation and reforestation add carbon to biomass; biochar and soil-carbon sequestration add to soil pools.

## 7. Terrestrial Biosphere Carbon Cycle

Models carbon flows among atmospheric CO2, vegetation biomass, soil organic carbon, and harvested products. Growth and respiration depend on temperature, atmospheric CO2 (fertilization), and land area in each pool. Stored carbon is reversible — fire, pests, harvest, and decay can return C to atmosphere.

## 8. Emissions

Six tracked species: CO2 (energy + land use), CH4 (fossil leaks, livestock, rice, waste), N2O (fertilizers, manure, industry), and F-gases (HFCs, PFCs, SF6, NF3) from industry and consumer goods. Each gas is modeled separately — internally there is no GWP conversion; GWP100 is used only for display (CO2-equivalent reporting). Aerosol species (sulfates, organic carbon, black carbon) also tracked.

## 9. Carbon Dioxide Removal (CDR)

Three CDR pools: nature-based (afforestation, reforestation, agricultural soil C, biochar), technological (DACCS, enhanced mineralization), and BECCS. Each pool has subsidy, build-rate, energy-input, and leakage parameters. Most technologies are in pilot stage; build-out is delay-constrained even at high subsidy.

## 10. Well-Mixed Greenhouse Gas Cycles

CO2, CH4, N2O, F-gases each have explicit atmospheric cycles. CO2 partitions among atmosphere, ocean (surface and deep, via the new Ocean Systems submodel), and biosphere with characteristic time constants. CH4 and N2O have first-order decay with chemistry-mediated lifetimes. F-gas lifetimes range from years to millennia.

## 11. Climate

Effective radiative forcing (May 2026 update) drives a multi-layer ocean-atmosphere energy balance to compute global mean surface temperature. Equilibrium climate sensitivity and transient climate response are calibrated to AR6 ranges. Temperature continues to rise after CO2 stabilizes due to ocean thermal inertia.

## 12. Ocean Systems

Disaggregated ocean submodel (April 2026 release) tracks surface and deep ocean heat and carbon uptake, including alkalinity effects on CO2 solubility. Sea level rise combines thermal expansion plus ice melt contributions. Ocean acidification follows from dissolved CO2 and carbonate chemistry.

## 13. Damage to GDP

Climate damages to economic growth are computed via a damage function applied to GDP per capita growth. Functional forms from Burke et al. (2018, 2015), Dietz & Stern (2015), and Howard & Sterner (2017) are selectable in Assumptions. Damages feed back to energy demand, partially self-limiting emissions.

## 14. Other Impacts

Non-economic impacts: deaths from extreme heat, outdoor labor loss, malaria/dengue exposure, crop yield/nutrient decrease, sea level rise exposure, ocean acidification, ice-free Arctic probability, species extinction risk, climate range loss, drought/wildfire/arid land. Each is parameterized from peer-reviewed studies.

## 15. Model Comparison — History and Future

En-ROADS results are benchmarked against historical observations (HadCRUT5, GISTEMP, NOAA RF, IEA, Global Carbon Budget, PRIMAP, UNEP) and against the IPCC SSP/RCP scenarios produced by IAMs (GCAM, MESSAGE-GLOBIOM, REMIND-MAgPIE, IMAGE, AIM/CGE, WITCH-GLOBIOM).

## 16. Initialization, Calibration, Model Testing

Initialization uses 1990 stocks. Calibration iteratively adjusts parameters to fit historical data and AR6 / IAM scenarios. Testing includes sensitivity sweeps, extreme-condition tests, and replication of well-known dynamics (e.g., bathtub stock-flow behavior).

## References

The Technical Reference cites hundreds of peer-reviewed sources spanning IPCC AR5/AR6, IEA WEO, NOAA, GCB, and the Stanford Energy Modeling Forum. See the source PDF (pp. 110-131) for the full bibliography.
