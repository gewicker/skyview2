package enrich

// Bundled instant lookups: airline by callsign prefix, human type name by ICAO type
// code. Stubs for now — the v1 airlines.json / types.json datasets are ported in
// Workstream A, after which these embed + resolve them. adsbdb covers both meanwhile,
// so enrichment is fully functional without the tables (just one network hop slower
// on first sighting of a given callsign/type).
func lookupType(code string) string { _ = code; return "" }

func lookupAirline(callsign string) string { _ = callsign; return "" }
