// =====================================================================
//  Configuración de la app
//  Si SUPABASE_URL está vacío, la app funciona en "modo prueba":
//  los datos se guardan solo en este navegador (sirve para probarla).
// =====================================================================
window.CONFIG = {
  // Supabase > Project Settings > API > Project URL
  SUPABASE_URL: 'https://mxpzwbfbjloxtamaiyho.supabase.co',
  // Supabase > Project Settings > API > Project API keys > anon / public
  SUPABASE_ANON_KEY: 'sb_publishable_KaON4YT5pgNXJB4L-4OWjQ_tc1gzw7q',
  NOMBRE_APP: 'Cuidando a la abuela',

  PERSONAS: [
    { id: 'carmen',    nombre: 'Carmen',    color: '#d9577a' },
    { id: 'tono',      nombre: 'Tono',      color: '#3b7ddd' },
    { id: 'pilar',     nombre: 'Pilar',     color: '#8a5cd6' },
    { id: 'tito',      nombre: 'Tito',      color: '#d98a12' },
    { id: 'yanka',     nombre: 'Yanka',     color: '#159a6e' },
    { id: 'cuidadora', nombre: 'Cuidadora', color: '#6b7a8f' },
  ],
};
