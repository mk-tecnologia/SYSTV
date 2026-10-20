export const TV_PALETTES = [
  { id: 'classic', name: 'Petróleo', description: 'Verde profundo e turquesa', background: '#34464c', row: '#122b2a', text: '#ffffff', accent: '#67f3df', badge: '#245ba5', muted: '#e1ecef' },
  { id: 'navy', name: 'Azul marinho', description: 'Azul profundo e azul gelo', background: '#182b46', row: '#0c1930', text: '#ffffff', accent: '#8cddff', badge: '#245ba5', muted: '#dae5f4' },
  { id: 'graphite', name: 'Grafite', description: 'Cinza escuro e dourado', background: '#303239', row: '#191b21', text: '#ffffff', accent: '#ffda80', badge: '#54504a', muted: '#e5e5ea' },
  { id: 'forest', name: 'Floresta', description: 'Verde escuro e menta', background: '#243d33', row: '#10271d', text: '#ffffff', accent: '#a0f5bc', badge: '#286043', muted: '#dcece1' },
  { id: 'plum', name: 'Ameixa', description: 'Roxo profundo e lavanda', background: '#33263f', row: '#201528', text: '#ffffff', accent: '#e2b8ff', badge: '#684080', muted: '#ece0f4' },
  { id: 'ivory', name: 'Marfim', description: 'Fundo claro e azul petróleo', background: '#f1eee6', row: '#ffffff', text: '#18323d', accent: '#00665b', badge: '#245563', muted: '#354f59' },
];
export function getTVPalette(id) { return TV_PALETTES.find(palette => palette.id === id) || TV_PALETTES[0]; }
