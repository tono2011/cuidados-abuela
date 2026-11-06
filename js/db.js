// =====================================================================
//  Capa de datos: Supabase (real, compartido) o modo prueba (localStorage)
//  Toda la app usa DB.cache[tabla] y DB.insert/update/remove.
// =====================================================================
(function () {
  const TABLAS = ['turnos', 'notas', 'medicamentos', 'tomas', 'tareas', 'contactos'];
  const CLAVE_DEMO = 'cuidados_demo_v1';
  const listeners = [];
  let sb = null;

  const DB = {
    modo: 'demo',
    cache: Object.fromEntries(TABLAS.map(t => [t, []])),
    onChange(fn) { listeners.push(fn); },
    get sb() { return sb; },
  };
  const emitir = () => listeners.forEach(fn => fn());

  // ------------------------------------------------------------ inicio
  DB.configurado = () => !!(window.CONFIG.SUPABASE_URL && window.CONFIG.SUPABASE_ANON_KEY);

  DB.init = async function () {
    if (!DB.configurado()) { DB.modo = 'demo'; demoCargar(); return; }
    DB.modo = 'supabase';
    // Versión fija + hash de integridad (SRI): si el CDN sirviera un archivo alterado, el navegador no lo ejecuta
    await cargarScript('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.50.0/dist/umd/supabase.min.js',
      'sha384-jP+y6mxch/vbLrNpx4basfv6ciZQuHwdRHgZGa6Mhja0Xm4p87ok2OQavTrRIGxH');
    sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
  };

  DB.sesion = async function () {
    if (DB.modo === 'demo') return true;
    const { data } = await sb.auth.getSession();
    return !!data.session;
  };

  DB.entrar = async function (email, password) {
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
  };

  DB.salir = async function () {
    if (DB.modo === 'supabase') await sb.auth.signOut();
  };

  // ------------------------------------------------------------ lectura
  DB.cargarTodo = async function () {
    if (DB.modo === 'demo') { demoCargar(); emitir(); return; }
    await Promise.all(TABLAS.map(cargarTabla));
    emitir();
    if (!DB._canal) {
      let t = {};
      DB._canal = sb.channel('cambios')
        .on('postgres_changes', { event: '*', schema: 'public' }, p => {
          // agrupar ráfagas de cambios
          clearTimeout(t[p.table]);
          t[p.table] = setTimeout(async () => { await cargarTabla(p.table); emitir(); }, 150);
        })
        .subscribe();
    }
  };

  async function cargarTabla(tabla) {
    if (!TABLAS.includes(tabla)) return;
    let q = sb.from(tabla).select('*');
    const hace = d => new Date(Date.now() - d * 864e5);
    if (tabla === 'turnos') q = q.gte('fin', hace(45).toISOString()).order('inicio');
    if (tabla === 'notas') q = q.order('created_at', { ascending: false }).limit(300);
    if (tabla === 'tomas') q = q.gte('fecha', U.ymd(hace(30)));
    if (tabla === 'contactos') q = q.order('orden').order('nombre');
    if (tabla === 'tareas') q = q.order('created_at', { ascending: false }).limit(400);
    const { data, error } = await q;
    if (error) { console.error(tabla, error); App.aviso('Error cargando ' + tabla, true); return; }
    DB.cache[tabla] = data;
  }

  // ------------------------------------------------------------ escritura
  DB.insert = async function (tabla, filas) {
    filas = Array.isArray(filas) ? filas : [filas];
    if (DB.modo === 'demo') {
      filas.forEach(f => DB.cache[tabla].push({ id: uid(), created_at: new Date().toISOString(), ...f }));
      return demoGuardar();
    }
    const { error } = await sb.from(tabla).insert(filas);
    // 23505 = ya existía (p.ej. dos personas marcan la misma toma a la vez): no es un problema
    if (error && error.code !== '23505') throw error;
    await cargarTabla(tabla); emitir();
  };

  DB.update = async function (tabla, id, cambios) {
    if (DB.modo === 'demo') {
      const f = DB.cache[tabla].find(r => r.id === id);
      if (f) Object.assign(f, cambios);
      return demoGuardar();
    }
    const { error } = await sb.from(tabla).update(cambios).eq('id', id);
    if (error) throw error;
    await cargarTabla(tabla); emitir();
  };

  DB.remove = async function (tabla, id) {
    if (DB.modo === 'demo') {
      DB.cache[tabla] = DB.cache[tabla].filter(r => r.id !== id);
      if (tabla === 'medicamentos') DB.cache.tomas = DB.cache.tomas.filter(t => t.medicamento_id !== id);
      return demoGuardar();
    }
    const { error } = await sb.from(tabla).delete().eq('id', id);
    if (error) throw error;
    await cargarTabla(tabla); emitir();
  };

  // ------------------------------------------------------------ modo prueba
  function demoCargar() {
    let datos = null;
    try { datos = JSON.parse(localStorage.getItem(CLAVE_DEMO)); } catch (e) {}
    if (!datos) datos = demoSemilla();
    TABLAS.forEach(t => DB.cache[t] = datos[t] || []);
    demoGuardar(false);
  }
  function demoGuardar(avisar = true) {
    try { localStorage.setItem(CLAVE_DEMO, JSON.stringify(DB.cache)); } catch (e) {}
    if (avisar) emitir();
  }
  window.addEventListener('storage', e => { if (e.key === CLAVE_DEMO && DB.modo === 'demo') { demoCargar(); emitir(); } });
  DB.demoReiniciar = () => { try { localStorage.removeItem(CLAVE_DEMO); } catch (e) {} demoCargar(); emitir(); };

  function demoSemilla() {
    const hoy = new Date();
    const f = (d, h) => { const x = U.addDays(hoy, d); return new Date(`${U.ymd(x)}T${h}`).toISOString(); };
    const ahora = new Date().toISOString();
    const m1 = uid(), m2 = uid();
    return {
      turnos: [
        { id: uid(), persona: 'tono', inicio: f(0, '09:45'), fin: f(0, '16:15'), nota: '' },
        { id: uid(), persona: 'pilar', inicio: f(0, '16:15'), fin: f(0, '21:00'), nota: 'Llevo la cena' },
        { id: uid(), persona: 'cuidadora', inicio: f(0, '22:00'), fin: f(1, '09:00'), nota: 'Noche' },
        { id: uid(), persona: 'carmen', inicio: f(1, '09:00'), fin: f(1, '14:00'), nota: '' },
        { id: uid(), persona: 'yanka', inicio: f(1, '17:00'), fin: f(1, '21:30'), nota: '' },
        { id: uid(), persona: 'tito', inicio: f(2, '10:00'), fin: f(2, '13:00'), nota: 'Le acompaño al médico' },
      ],
      notas: [
        { id: uid(), persona: 'cuidadora', tipo: 'sueno', texto: 'Ha dormido bastante bien, se despertó una vez sobre las 4.', created_at: f(0, '08:50') },
        { id: uid(), persona: 'pilar', tipo: 'comida', texto: 'Cenó media tortilla y yogur. Bebió poco agua, insistid.', created_at: f(-1, '21:10') },
      ],
      medicamentos: [
        { id: m1, nombre: 'Ejemplo: Omeprazol', dosis: '20 mg', horas: ['09:00'], notas: 'En ayunas', activo: true, created_at: ahora },
        { id: m2, nombre: 'Ejemplo: Paracetamol', dosis: '1 g', horas: ['09:00', '15:00', '21:00'], notas: 'Si tiene dolor', activo: true, created_at: ahora },
      ],
      tomas: [
        { id: uid(), medicamento_id: m1, fecha: U.ymd(hoy), hora: '09:00', persona: 'cuidadora', created_at: f(0, '09:05') },
      ],
      tareas: [
        { id: uid(), titulo: 'Revisión en el centro de salud', tipo: 'cita', fecha: U.ymd(U.addDays(hoy, 2)), hora: '11:30', hecha: false, created_at: ahora },
        { id: uid(), titulo: 'Recoger recetas en la farmacia', tipo: 'tarea', fecha: U.ymd(hoy), hora: '', hecha: false, created_at: ahora },
        { id: uid(), titulo: 'Agua mineral', tipo: 'compra', fecha: null, hora: '', hecha: false, created_at: ahora },
        { id: uid(), titulo: 'Yogures', tipo: 'compra', fecha: null, hora: '', hecha: false, created_at: ahora },
      ],
      contactos: [
        { id: uid(), nombre: 'Emergencias', telefono: '112', rol: 'Urgencias', orden: 1 },
        { id: uid(), nombre: 'Centro de salud', telefono: '', rol: 'Cita previa', orden: 2 },
      ],
    };
  }

  // ------------------------------------------------------------ utilidades
  function uid() {
    return (crypto.randomUUID ? crypto.randomUUID() : 'id' + Math.random().toString(36).slice(2) + Date.now());
  }
  function cargarScript(src, integridad) {
    return new Promise((ok, ko) => {
      const s = document.createElement('script');
      if (integridad) { s.integrity = integridad; s.crossOrigin = 'anonymous'; }
      s.referrerPolicy = 'no-referrer';
      s.src = src; s.onload = ok; s.onerror = () => ko(new Error('No se pudo cargar ' + src));
      document.head.appendChild(s);
    });
  }

  window.DB = DB;
})();
