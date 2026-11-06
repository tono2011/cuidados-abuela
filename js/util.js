// Utilidades de fechas, texto y personas
window.U = {
  pad: n => String(n).padStart(2, '0'),
  ymd(d) { d = new Date(d); return `${d.getFullYear()}-${U.pad(d.getMonth() + 1)}-${U.pad(d.getDate())}`; },
  hm(d) { d = new Date(d); return `${U.pad(d.getHours())}:${U.pad(d.getMinutes())}`; },
  addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; },
  inicioDia(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; },
  lunes(d) { const x = U.inicioDia(d); const w = (x.getDay() + 6) % 7; return U.addDays(x, -w); },
  deFechaHora(fecha, hora) { return new Date(`${fecha}T${hora || '00:00'}`); },
  mismoDia: (a, b) => U.ymd(a) === U.ymd(b),

  diaLargo(d) {
    return new Date(d).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
  },
  diaCorto(d) {
    return new Date(d).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
  },
  // "hoy", "mañana", "ayer" o fecha corta
  diaRelativo(d) {
    const dif = Math.round((U.inicioDia(d) - U.inicioDia(new Date())) / 864e5);
    if (dif === 0) return 'hoy';
    if (dif === 1) return 'mañana';
    if (dif === -1) return 'ayer';
    return U.diaCorto(d);
  },
  duracion(ms) {
    const min = Math.round(ms / 60000), h = Math.floor(min / 60), m = min % 60;
    return h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`;
  },

  esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },

  persona(id) {
    return CONFIG.PERSONAS.find(p => p.id === id) || { id, nombre: id || '¿?', color: '#888' };
  },
  chip(id) {
    const p = U.persona(id);
    return `<span class="chip" style="--c:${p.color}">${U.esc(p.nombre)}</span>`;
  },
};
