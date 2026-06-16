package enrich

import "strings"

// Bundled instant lookups: airline by ICAO callsign prefix, human type name by ICAO
// type code. These resolve the common Seattle-corridor traffic with zero network
// latency; adsbdb fills in everything else (and overrides nothing the table already
// has — see enrich.go). Curated rather than the full v1 datasets: it covers the bulk
// of what actually flies over Bellevue without bloating the binary.

// airlineByICAO maps the 3-letter ICAO operator prefix of a callsign to a name.
var airlineByICAO = map[string]string{
	// Pacific Northwest mainstays.
	"ASA": "Alaska Airlines", "QXE": "Horizon Air", "SKW": "SkyWest",
	// US majors + low-cost.
	"DAL": "Delta", "UAL": "United", "AAL": "American", "SWA": "Southwest",
	"JBU": "JetBlue", "FFT": "Frontier", "NKS": "Spirit", "HAL": "Hawaiian",
	"AAY": "Allegiant", "SCX": "Sun Country", "RPA": "Republic", "ENY": "Envoy",
	"EDV": "Endeavor Air", "JIA": "PSA Airlines", "AWI": "Air Wisconsin",
	// Cargo.
	"FDX": "FedEx", "UPS": "UPS", "GTI": "Atlas Air", "GEC": "Lufthansa Cargo",
	"CKS": "Kalitta Air", "ABX": "ABX Air", "BOX": "AeroLogic", "CLX": "Cargolux",
	// International (common at SEA).
	"ACA": "Air Canada", "WJA": "WestJet", "AMX": "Aeroméxico", "VOI": "Volaris",
	"BAW": "British Airways", "DLH": "Lufthansa", "AFR": "Air France", "KLM": "KLM",
	"ANA": "All Nippon Airways", "JAL": "Japan Airlines", "KAL": "Korean Air",
	"AAR": "Asiana", "EVA": "EVA Air", "CPA": "Cathay Pacific", "CAL": "China Airlines",
	"QFA": "Qantas", "ICE": "Icelandair", "THY": "Turkish Airlines", "UAE": "Emirates",
	"QTR": "Qatar Airways", "CES": "China Eastern", "CCA": "Air China", "CSN": "China Southern",
	// Military / state.
	"RCH": "US Air Mobility (Reach)", "PAT": "US Army Priority Air Transport",
}

// typeByICAO maps an ICAO aircraft type code to a readable name.
var typeByICAO = map[string]string{
	// 737 family.
	"B712": "Boeing 717", "B733": "Boeing 737-300", "B734": "Boeing 737-400",
	"B735": "Boeing 737-500", "B736": "Boeing 737-600", "B737": "Boeing 737-700",
	"B738": "Boeing 737-800", "B739": "Boeing 737-900",
	"B37M": "Boeing 737 MAX 7", "B38M": "Boeing 737 MAX 8", "B39M": "Boeing 737 MAX 9", "B3XM": "Boeing 737 MAX 10",
	// Boeing widebodies.
	"B752": "Boeing 757-200", "B753": "Boeing 757-300", "B762": "Boeing 767-200",
	"B763": "Boeing 767-300", "B764": "Boeing 767-400", "B772": "Boeing 777-200",
	"B77L": "Boeing 777-200LR", "B773": "Boeing 777-300", "B77W": "Boeing 777-300ER",
	"B788": "Boeing 787-8", "B789": "Boeing 787-9", "B78X": "Boeing 787-10",
	"B744": "Boeing 747-400", "B748": "Boeing 747-8",
	// Airbus.
	"A319": "Airbus A319", "A320": "Airbus A320", "A321": "Airbus A321",
	"A19N": "Airbus A319neo", "A20N": "Airbus A320neo", "A21N": "Airbus A321neo",
	"A306": "Airbus A300-600", "A310": "Airbus A310", "A332": "Airbus A330-200",
	"A333": "Airbus A330-300", "A339": "Airbus A330-900neo", "A359": "Airbus A350-900",
	"A35K": "Airbus A350-1000", "A388": "Airbus A380-800",
	// Regional jets + props.
	"E170": "Embraer E170", "E75L": "Embraer E175", "E75S": "Embraer E175",
	"E190": "Embraer E190", "E195": "Embraer E195", "E290": "Embraer E190-E2",
	"CRJ2": "Bombardier CRJ200", "CRJ7": "Bombardier CRJ700", "CRJ9": "Bombardier CRJ900",
	"DH8D": "Bombardier Dash 8 Q400", "AT72": "ATR 72", "AT76": "ATR 72-600",
	// GA / bizjet common over Seattle.
	"C172": "Cessna 172", "C182": "Cessna 182", "C208": "Cessna 208 Caravan",
	"PC12": "Pilatus PC-12", "SR22": "Cirrus SR22", "TBM9": "Daher TBM 900",
	"C25A": "Cessna CJ2", "C56X": "Cessna Citation XLS", "C680": "Cessna Citation Sovereign",
	"GLF5": "Gulfstream G550", "GLF6": "Gulfstream G650", "CL35": "Bombardier Challenger 350",
}

func lookupType(code string) string {
	return typeByICAO[strings.ToUpper(strings.TrimSpace(code))]
}

func lookupAirline(callsign string) string {
	cs := strings.ToUpper(strings.TrimSpace(callsign))
	if len(cs) < 3 {
		return ""
	}
	// ICAO operator prefix is the leading 3 letters of the callsign.
	p := cs[:3]
	for _, c := range p {
		if c < 'A' || c > 'Z' {
			return ""
		}
	}
	return airlineByICAO[p]
}
