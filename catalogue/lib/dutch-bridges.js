/**
 * Extra Dutch movable spans from isdetunnelopen.nl.
 * ON means the span is open to ships (road closed or a live bridge event).
 * Erasmusbrug is already in switches.json — do not add it again.
 */
function extraDutchBridgeSpecs() {
	return [
		['brienenoordbrug', 'Van Brienenoordbrug open', 'Rotterdam', 'ON while Rotterdam\'s Van Brienenoordbrug is open to shipping on the Nieuwe Maas. Pause a commute scene or light the river. Openings: isdetunnelopen.nl.'],
		['botlekbrug', 'Botlekbrug open', 'Rotterdam', 'ON while the Botlekbrug in Rotterdam harbour is open to ships. A dockside lamp for A15 river traffic. Openings: isdetunnelopen.nl.'],
		['spijkenisserbrug', 'Spijkenisserbrug open', 'Spijkenisse', 'ON while the Spijkenisserbrug over the Oude Maas is open to shipping. Pair it with a harbour scene. Openings: isdetunnelopen.nl.'],
		['ketelbrug', 'Ketelbrug open', 'Ketelmeer', 'ON while the Ketelbrug on the A6 is open to ships on the Ketelmeer. A lakeside light for a rare lift. Openings: isdetunnelopen.nl.'],
		['merwedebrug', 'Merwedebrug open', 'Gorinchem', 'ON while the Merwedebrug near Gorinchem is open to shipping. Flash a porch for A27 river traffic. Openings: isdetunnelopen.nl.'],
		['haringvlietbrug', 'Haringvlietbrug open', 'Haringvliet', 'ON while the Haringvlietbrug is open to ships. A coastal lamp for the Haringvliet crossing. Openings: isdetunnelopen.nl.'],
		['zeelandbrug', 'Zeelandbrug open', 'Zeeland', 'ON while the Zeelandbrug over the Oosterschelde is open to shipping. A long-span light for Zeeland. Openings: isdetunnelopen.nl.'],
		['kaagbrug', 'Kaagbrug open', 'Kaag', 'ON while the Kaagbrug on the A44 is open to ships. Pause a Leiden-bound scene when the span lifts. Openings: isdetunnelopen.nl.'],
		['algerabrug', 'Algerabrug open', 'Krimpen aan den IJssel', 'ON while the Algerabrug at Krimpen is open to shipping. A river lamp for the Hollandse IJssel. Openings: isdetunnelopen.nl.'],
		['prinsclausbrug', 'Prins Clausbrug open', 'Dordrecht', 'ON while Dordrecht\'s Prins Clausbrug is open to ships. Pair it with a harbour scene. Openings: isdetunnelopen.nl.'],
		['cruquiusbrug', 'Cruquiusbrug open', 'Haarlemmermeer', 'ON while the Cruquiusbrug is open to shipping. A polder lamp for a Haarlem-bound lift. Openings: isdetunnelopen.nl.'],
		['kooybrug', 'Kooybrug open', 'Den Helder', 'ON while the Kooybrug near Den Helder is open to ships. A North Holland harbour light. Openings: isdetunnelopen.nl.'],
		['leimuiderbrug', 'Leimuiderbrug open', 'Leimuiden', 'ON while the Leimuiderbrug on the A4 is open to shipping. Pause a Schiphol-bound scene when the span lifts. Openings: isdetunnelopen.nl.']
	].map(([id, name, location, description]) => ({
		id,
		name,
		description,
		location,
		category: 'Transport',
		link: `https://isdetunnelopen.nl/${id}`,
		art: 'erasmusbrug',
		onMeans: 'The span is open to ships.',
		offMeans: 'The span is closed for road traffic.',
		schedule: {
			kind: 'observe',
			source: id,
			state: false,
			staleAfterHours: 2
		}
	}));
}

module.exports = {
	extraDutchBridgeSpecs
};
