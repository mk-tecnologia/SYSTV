export const TV_PALETTES = [
  { id: 'classic', name: 'Petróleo', description: 'Verde profundo e turquesa', background: '#34464c', row: '#122b2a', text: '#ffffff', accent: '#67f3df', badge: '#245ba5', muted: '#e1ecef' },
  { id: 'navy', name: 'Azul marinho', description: 'Azul profundo e azul gelo', background: '#182b46', row: '#0c1930', text: '#ffffff', accent: '#8cddff', badge: '#245ba5', muted: '#dae5f4' },
  { id: 'graphite', name: 'Grafite', description: 'Cinza escuro e dourado', background: '#303239', row: '#191b21', text: '#ffffff', accent: '#ffda80', badge: '#54504a', muted: '#e5e5ea' },
  { id: 'forest', name: 'Floresta', description: 'Verde escuro e menta', background: '#243d33', row: '#10271d', text: '#ffffff', accent: '#a0f5bc', badge: '#286043', muted: '#dcece1' },
  { id: 'plum', name: 'Ameixa', description: 'Roxo profundo e lavanda', background: '#33263f', row: '#201528', text: '#ffffff', accent: '#e2b8ff', badge: '#684080', muted: '#ece0f4' },
  { id: 'ivory', name: 'Marfim', description: 'Fundo claro e azul petróleo', background: '#f1eee6', row: '#ffffff', text: '#18323d', accent: '#00665b', badge: '#245563', muted: '#354f59' },
  { id: 'midnight', name: 'Noturno', description: 'Preto azulado e amarelo luminoso', background: '#101820', row: '#182430', text: '#ffffff', accent: '#ffe08a', badge: '#273c50', muted: '#d8e2ec' },
  { id: 'wine', name: 'Bordô', description: 'Vinho escuro e pêssego', background: '#321b28', row: '#21131b', text: '#fff7fa', accent: '#ffd0a8', badge: '#623044', muted: '#f1dce5' },
  { id: 'coffee', name: 'Café', description: 'Marrom profundo e creme', background: '#30251f', row: '#1e1713', text: '#fff9ef', accent: '#ffe1a6', badge: '#59402c', muted: '#eadfce' },
  { id: 'ice', name: 'Gelo', description: 'Azul claro e azul profundo', background: '#e8f1fa', row: '#ffffff', text: '#132c46', accent: '#174a78', badge: '#174a78', muted: '#304a63' },
  { id: 'sage', name: 'Sálvia', description: 'Verde suave e verde profundo', background: '#e9f1e8', row: '#ffffff', text: '#20392c', accent: '#24573d', badge: '#24573d', muted: '#3b5142' },
  { id: 'peach', name: 'Pêssego', description: 'Fundo quente e terracota escura', background: '#fff0e4', row: '#ffffff', text: '#40291e', accent: '#843b23', badge: '#843b23', muted: '#634739' },
];
export function getTVPalette(id) { return TV_PALETTES.find(palette => palette.id === id) || TV_PALETTES[0]; }
