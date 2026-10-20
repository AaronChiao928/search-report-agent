// Metric definitions and number formatting.
// Base metrics can be summed across categories; ratios are always rebuilt from base metrics,
// never taken from the dashboard, so they can't carry reading errors.

export const BASE = [
  { k: "impr", label: "Impressions", fmt: "int" },
  { k: "clicks", label: "Clicks", fmt: "int" },
  { k: "cost", label: "Cost", fmt: "eur0" },
  { k: "qv", label: "Clean QV", fmt: "int" },
  { k: "ec", label: "eComm clicks", fmt: "int" },
];

export const RATIOS = [
  { k: "ctr", label: "CTR", num: "clicks", den: "impr", fmt: "pct" },
  { k: "cpc", label: "CPC", num: "cost", den: "clicks", fmt: "eur2" },
  { k: "qvr", label: "QV rate (CVR)", num: "qv", den: "clicks", fmt: "pct" },
  { k: "qvcpa", label: "QV CPA", num: "cost", den: "qv", fmt: "eur2" },
  { k: "ecr", label: "eComm click rate", num: "ec", den: "clicks", fmt: "pct" },
  { k: "eccpa", label: "eComm click CPA", num: "cost", den: "ec", fmt: "eur2" },
];

// Name used for the part of the market total that the listed categories don't cover.
export const UNALLOC = "Unallocated";

const nf = (n, d) =>
  Number(n).toLocaleString("en-GB", { minimumFractionDigits: d, maximumFractionDigits: d });

export function fmt(v, type) {
  if (v == null || !Number.isFinite(v)) return "n/a";
  switch (type) {
    case "int": return nf(Math.round(v), 0);
    case "eur0": return "€" + nf(v, 0);
    case "eur2": return "€" + nf(v, 2);
    case "pct": return (v * 100).toFixed(2) + "%";
    case "chg": return (v >= 0 ? "+" : "") + (v * 100).toFixed(1) + "%";
    case "share": return (v * 100).toFixed(0) + "%";
    case "pp": return (v >= 0 ? "+" : "") + (v * 100).toFixed(2) + " pp";
    case "deur": return (v >= 0 ? "+€" : "-€") + nf(Math.abs(v), 2);
    case "deur0": return (v >= 0 ? "+€" : "-€") + nf(Math.abs(v), 0);
    case "dint": return (v >= 0 ? "+" : "-") + nf(Math.abs(Math.round(v)), 0);
    default: return String(v);
  }
}

// Format used for a *difference* in a metric of the given format.
export const deltaFmt = (t) =>
  t === "pct" ? "pp" : t === "eur2" ? "deur" : t === "eur0" ? "deur0" : "dint";
