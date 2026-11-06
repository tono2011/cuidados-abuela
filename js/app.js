// =====================================================================
//  Cuidando a la abuela · lógica de la app
// =====================================================================
(function () {
  // Anti-clickjacking: GitHub Pages no permite la cabecera X-Frame-Options, así que no dejamos que nos metan en un iframe
  if (window.top !== window.self) { document.documentElement.innerHTML = ''; return; }

  const $ = s => document.querySelector(s);
  const esc = U.esc;
  const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };

  const S = {
    persona: null,
    vista: lsGet('cuidados_vista') || 'hoy',
    semana: 0,                 // desplazamiento de semanas en Turnos
    diaMed: U.ymd(new Date()), // día mostrado en Medicación
    tipoNota: 'general',
    pendiente: false,          // hay que repintar cuando se deje de escribir
  };

  const TIPOS_NOTA = {
    general: ['💬', 'General'], comida: ['🍽️', 'Comida'], sueno: ['😴', 'Sueño'],
    salud: ['🩺', 'Salud'], animo: ['🙂', 'Ánimo'],
  };

  // ------------------------------------------------------------------ avisos
  let tToast;
  const App = window.App = {
    aviso(msg, mal = false) {
      const t = $('#toast');
      t.textContent = msg; t.classList.toggle('mal', mal); t.classList.add('ver');
      clearTimeout(tToast); tToast = setTimeout(() => t.classList.remove('ver'), 2600);
    },
  };
  async function intentar(fn, ok) {
    try { await fn(); if (ok) App.aviso(ok); return true; }
    catch (e) { console.error(e); App.aviso('No se pudo guardar: ' + (e.message || e), true); return false; }
  }

  // ------------------------------------------------------------------ arranque
  async function arrancar() {
    document.title = CONFIG.NOMBRE_APP;
    $('#titulo-inicio').textContent = CONFIG.NOMBRE_APP;
    $('#titulo-app').textContent = CONFIG.NOMBRE_APP;
    try { await DB.init(); }
    catch (e) { return inicio(`<p class="error">No se pudo conectar. Revisa la conexión a internet y recarga.</p>`); }
    if (!(await DB.sesion())) return pantallaLogin();
    elegirPersonaOAbrir();
  }

  function inicio(html) {
    $('#app').hidden = true; $('#pantalla-inicio').hidden = false;
    $('#inicio-contenido').innerHTML = html;
  }

  function pantallaLogin() {
    inicio(`
      <form id="form-login" class="tarjeta" style="text-align:left">
        <div class="campo">
          <label for="em">Email</label>
          <input id="em" type="email" autocomplete="username" inputmode="email" autocapitalize="off" required autofocus>
        </div>
        <div class="campo">
          <label for="pw">Contraseña</label>
          <input id="pw" type="password" autocomplete="current-password" required>
        </div>
        <button class="btn grande">Entrar</button>
        <div id="login-error" class="error" hidden></div>
      </form>
      <p class="suave peq">Solo hace falta entrar una vez en cada móvil.</p>`);
    $('#form-login').onsubmit = async e => {
      e.preventDefault();
      const err = $('#login-error'); err.hidden = true;
      try { await DB.entrar($('#em').value.trim().toLowerCase(), $('#pw').value); elegirPersonaOAbrir(); }
      catch (ex) { err.hidden = false; err.textContent = 'Email o contraseña incorrectos, o sin conexión.'; }
    };
  }

  function elegirPersonaOAbrir() {
    S.persona = lsGet('cuidados_persona');
    if (!CONFIG.PERSONAS.some(p => p.id === S.persona)) return pantallaPersona();
    abrirApp();
  }

  function pantallaPersona() {
    inicio(`
      <p>¿Quién eres?</p>
      <div class="personas-grid">
        ${CONFIG.PERSONAS.map(p => `<button class="persona-btn" style="--c:${p.color}" data-elegir="${p.id}">${esc(p.nombre)}</button>`).join('')}
      </div>
      <p class="suave peq" style="margin-top:16px">Se recuerda en este móvil. Puedes cambiarlo tocando tu nombre arriba.</p>`);
    document.querySelectorAll('[data-elegir]').forEach(b => b.onclick = () => {
      S.persona = b.dataset.elegir; lsSet('cuidados_persona', S.persona); abrirApp();
    });
  }

  let appIniciada = false;
  async function abrirApp() {
    $('#pantalla-inicio').hidden = true; $('#app').hidden = false;
    $('#banner-demo').hidden = DB.modo !== 'demo';
    if (!appIniciada) {
      appIniciada = true;
      DB.onChange(pintar);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') DB.cargarTodo();
      });
      setInterval(() => { if (S.vista === 'hoy' || S.vista === 'medicacion') pintar(); }, 60000);
    }
    pintar();
    await DB.cargarTodo();
  }

  // ------------------------------------------------------------------ pintar
  function pintar() {
    if ($('#app').hidden) return;
    // No repintar mientras alguien escribe en la vista (se perdería el texto)
    const act = document.activeElement;
    if (act && $('#vista').contains(act) && /INPUT|TEXTAREA|SELECT/.test(act.tagName)) { S.pendiente = true; return; }
    S.pendiente = false;
    document.querySelectorAll('.barra button').forEach(b => b.classList.toggle('activa', b.dataset.vista === S.vista));
    $('#cab-persona').innerHTML = U.chip(S.persona);
    const fn = VISTAS[S.vista] || VISTAS.hoy;
    $('#vista').innerHTML = fn();
    restaurarBorradores();
  }
  document.addEventListener('focusout', () => setTimeout(() => { if (S.pendiente) pintar(); }, 50));

  // Borradores de los campos de texto de la vista (sobreviven a repintados)
  const borradores = {};
  document.addEventListener('input', e => { if (e.target.dataset.borrador) borradores[e.target.dataset.borrador] = e.target.value; });
  function restaurarBorradores() {
    document.querySelectorAll('[data-borrador]').forEach(el => { if (borradores[el.dataset.borrador]) el.value = borradores[el.dataset.borrador]; });
  }

  // ------------------------------------------------------------------ cálculos de turnos
  const turnosEntre = (a, b) => DB.cache.turnos
    .filter(t => new Date(t.inicio) < b && new Date(t.fin) > a)
    .sort((x, y) => new Date(x.inicio) - new Date(y.inicio));

  function huecos(a, b, minMin = 30) {
    const segs = turnosEntre(a, b).map(t => [Math.max(+new Date(t.inicio), +a), Math.min(+new Date(t.fin), +b)]).sort((x, y) => x[0] - y[0]);
    const res = []; let cursor = +a;
    for (const [i, f] of segs) {
      if (i - cursor >= minMin * 60000) res.push([new Date(cursor), new Date(i)]);
      cursor = Math.max(cursor, f);
    }
    if (+b - cursor >= minMin * 60000) res.push([new Date(cursor), new Date(b)]);
    return res;
  }

  function textoHueco([a, b]) {
    const finTxt = U.mismoDia(a, b) ? U.hm(b)
      : +b === +U.addDays(U.inicioDia(a), 1) ? '24:00'
      : `${U.hm(b)} (${U.diaRelativo(b)})`;
    return `${U.diaRelativo(a)} ${U.hm(a)}–${finTxt}`;
  }

  function horasTurno(t, diaRef) {
    const i = new Date(t.inicio), f = new Date(t.fin);
    let txt = `${U.hm(i)}–${U.hm(f)}`;
    if (diaRef && !U.mismoDia(i, diaRef)) txt = `${U.diaRelativo(i) === 'ayer' ? 'ayer ' : '← '}${txt}`;
    else if (!U.mismoDia(i, f)) txt += ' (+1)';
    return txt;
  }

  // ------------------------------------------------------------------ vistas
  const VISTAS = {};

  // ======== HOY
  VISTAS.hoy = function () {
    const ahora = new Date();
    const enCurso = turnosEntre(ahora, new Date(+ahora + 1));
    const proximo = DB.cache.turnos.filter(t => new Date(t.inicio) > ahora).sort((a, b) => new Date(a.inicio) - new Date(b.inicio))[0];
    const hs = huecos(ahora, new Date(+ahora + 24 * 3600e3));
    const misTurnos = DB.cache.turnos.filter(t => t.persona === S.persona && new Date(t.fin) > ahora)
      .sort((a, b) => new Date(a.inicio) - new Date(b.inicio)).slice(0, 3);

    let estado;
    if (enCurso.length) {
      estado = `<div class="ahora"><span class="punto-vivo"></span><div>
        <div class="grande">${enCurso.map(t => U.chip(t.persona)).join(' ')} ${enCurso.length > 1 ? 'están' : 'está'} con ella</div>
        <div class="suave">hasta las ${U.hm(new Date(Math.max(...enCurso.map(t => +new Date(t.fin)))))}</div></div></div>`;
    } else {
      estado = `<div class="ahora"><span class="punto-vivo mal"></span><div>
        <div class="grande">Ahora no hay nadie apuntado</div>
        ${proximo ? `<div class="suave">Siguiente: ${U.chip(proximo.persona)} ${U.diaRelativo(proximo.inicio)} a las ${U.hm(proximo.inicio)}</div>` : ''}
        </div></div>`;
    }
    const avisoHuecos = hs.length
      ? `<div class="aviso-hueco">⚠️ Sin nadie en las próximas 24 h:<br>${hs.slice(0, 4).map(textoHueco).join('<br>')}</div>`
      : `<div class="aviso-ok">✓ Cubierto las próximas 24 horas</div>`;

    return `
      <div class="saludo">
        <h1>Hola, ${esc(U.persona(S.persona).nombre)}</h1>
        <p>${U.diaLargo(ahora)}</p>
      </div>

      <section class="tarjeta">
        <h2>Ahora mismo</h2>
        ${estado}
        ${avisoHuecos}
        <div class="acciones" style="margin-top:12px">
          <button class="btn sec mini" data-accion="ir" data-ir="turnos">Ver turnos</button>
          <button class="btn mini" data-accion="turno-nuevo">+ Apuntarme</button>
        </div>
      </section>

      <section class="tarjeta">
        <h2>💊 Medicación de hoy <button class="enlace peq" data-accion="ir" data-ir="medicacion">Ver todo</button></h2>
        ${listaTomas(U.ymd(ahora))}
      </section>

      ${tarjetaPendientes()}

      <section class="tarjeta">
        <h2>📝 Últimas notas <button class="btn mini" data-accion="ir" data-ir="diario">+ Nota</button></h2>
        ${DB.cache.notas.length ? `<ul class="lista">${ordenNotas().slice(0, 3).map(itemNota).join('')}</ul>` : '<div class="vacio">Todavía no hay notas.</div>'}
      </section>

      <section class="tarjeta">
        <h2>🗓️ Tus próximos turnos</h2>
        ${misTurnos.length ? misTurnos.map(t => `
          <button class="turno" data-accion="turno-editar" data-id="${t.id}">
            <span class="horas">${U.diaRelativo(t.inicio)} · ${horasTurno(t)}</span>
            <span class="nota">${esc(t.nota || '')}</span>
          </button>`).join('') : '<div class="vacio">No tienes turnos apuntados.</div>'}
      </section>

      <p class="suave peq" style="text-align:center">
        <button class="enlace" data-accion="cambiar-persona">No soy ${esc(U.persona(S.persona).nombre)}</button>
        ${DB.modo === 'supabase' ? ' · <button class="enlace" data-accion="salir">Cerrar sesión</button>' : ''}
      </p>`;
  };

  function tarjetaPendientes() {
    const hoy = U.ymd(new Date()), manana = U.ymd(U.addDays(new Date(), 1));
    const citas = DB.cache.tareas.filter(t => t.tipo === 'cita' && !t.hecha && t.fecha && t.fecha >= hoy && t.fecha <= manana);
    const tareas = DB.cache.tareas.filter(t => t.tipo === 'tarea' && !t.hecha && (!t.fecha || t.fecha <= hoy));
    const compra = DB.cache.tareas.filter(t => t.tipo === 'compra' && !t.hecha).length;
    const items = [...ordenTareas(citas), ...ordenTareas(tareas).slice(0, 5)];
    return `
      <section class="tarjeta">
        <h2>✅ Pendiente <button class="enlace peq" data-accion="ir" data-ir="agenda">Agenda</button></h2>
        ${items.length ? `<ul class="lista">${items.map(itemTarea).join('')}</ul>` : '<div class="vacio">Nada pendiente para hoy.</div>'}
        ${compra ? `<p class="peq" style="margin:10px 0 0">🛒 ${compra} ${compra === 1 ? 'cosa' : 'cosas'} en la lista de la compra</p>` : ''}
      </section>`;
  }

  // ======== TURNOS
  VISTAS.turnos = function () {
    const lunes = U.addDays(U.lunes(new Date()), S.semana * 7);
    const domingo = U.addDays(lunes, 6);
    const ahora = new Date();
    const titulo = S.semana === 0 ? 'Esta semana' : S.semana === 1 ? 'Semana que viene' : S.semana === -1 ? 'Semana pasada'
      : `${lunes.getDate()} ${lunes.toLocaleDateString('es-ES', { month: 'short' })} – ${domingo.getDate()} ${domingo.toLocaleDateString('es-ES', { month: 'short' })}`;

    // horas por persona en la semana
    const horas = {};
    turnosEntre(lunes, U.addDays(lunes, 7)).forEach(t => {
      const ms = Math.min(+new Date(t.fin), +U.addDays(lunes, 7)) - Math.max(+new Date(t.inicio), +lunes);
      horas[t.persona] = (horas[t.persona] || 0) + ms;
    });

    let dias = '';
    for (let i = 0; i < 7; i++) {
      const d0 = U.addDays(lunes, i), d1 = U.addDays(d0, 1);
      const ts = turnosEntre(d0, d1);
      const esHoy = U.mismoDia(d0, ahora);
      const segs = ts.map(t => {
        const a = Math.max(+new Date(t.inicio), +d0), b = Math.min(+new Date(t.fin), +d1);
        return `<span class="seg" style="--c:${U.persona(t.persona).color};left:${(a - d0) / 864e5 * 100}%;width:${(b - a) / 864e5 * 100}%"></span>`;
      }).join('');
      const marca = esHoy ? `<span class="ahora-marca" style="left:${(ahora - d0) / 864e5 * 100}%"></span>` : '';
      const hs = d1 > ahora ? huecos(new Date(Math.max(+d0, +ahora)), d1) : [];
      dias += `
        <section class="tarjeta dia ${esHoy ? 'hoy' : ''}" ${d1 <= ahora ? 'style="opacity:.6"' : ''}>
          <div class="dia-cab">
            <h3>${d0.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric' })}</h3>
            ${esHoy ? '<span class="etiqueta-hoy">Hoy</span>' : ''}
          </div>
          <div class="barra-dia">${segs}${marca}</div>
          <div class="escala"><span>0</span><span>6</span><span>12</span><span>18</span><span>24</span></div>
          ${ts.map(t => `
            <button class="turno" data-accion="turno-editar" data-id="${t.id}">
              <span class="horas">${horasTurno(t, d0)}</span>
              ${U.chip(t.persona)}
              <span class="nota">${esc(t.nota || '')}</span>
            </button>`).join('')}
          ${hs.length ? `<div class="huecos">Sin cubrir: ${hs.map(([a, b]) => `${U.hm(a)}–${+b === +d1 ? '24:00' : U.hm(b)}`).join(', ')}</div>` : ''}
          <div class="acciones" style="margin-top:6px">
            <button class="btn sec mini" data-accion="turno-nuevo" data-fecha="${U.ymd(d0)}">+ Turno</button>
          </div>
        </section>`;
    }

    return `
      <div class="tit-vista"><h1>Turnos</h1><button class="btn" data-accion="turno-nuevo">+ Apuntarme</button></div>
      <div class="nav-semana">
        <button class="icono-btn" data-accion="semana" data-d="-1" aria-label="Semana anterior">‹</button>
        <strong>${titulo}</strong>
        ${S.semana !== 0 ? '<button class="btn sec mini" data-accion="semana" data-d="0">Hoy</button>' : ''}
        <button class="icono-btn" data-accion="semana" data-d="1" aria-label="Semana siguiente">›</button>
      </div>
      ${Object.keys(horas).length ? `<div class="leyenda">${Object.entries(horas).sort((a, b) => b[1] - a[1])
        .map(([p, ms]) => `<span style="white-space:nowrap;margin-right:6px">${U.chip(p)} <span class="suave peq">${U.duracion(ms)}</span></span>`).join('')}</div>` : ''}
      ${dias}`;
  };

  function formTurno(t, fechaDefecto) {
    const nuevo = !t;
    const ult = JSON.parse(lsGet('cuidados_ult_turno') || '{}');
    const persona = t ? t.persona : S.persona;
    const fecha = t ? U.ymd(t.inicio) : (fechaDefecto || U.ymd(new Date()));
    const desde = t ? U.hm(t.inicio) : (ult.desde || '09:00');
    const hasta = t ? U.hm(t.fin) : (ult.hasta || '14:00');
    modal(`
      <h2>${nuevo ? 'Nuevo turno' : 'Editar turno'}</h2>
      <div class="campo"><label>Quién</label>
        <select name="persona">${CONFIG.PERSONAS.map(p => `<option value="${p.id}" ${p.id === persona ? 'selected' : ''}>${esc(p.nombre)}</option>`).join('')}</select></div>
      <div class="campo"><label>Día</label><input type="date" name="fecha" value="${fecha}" required></div>
      <div class="fila">
        <div class="campo"><label>Desde</label><input type="time" name="desde" value="${desde}" required></div>
        <div class="campo"><label>Hasta</label><input type="time" name="hasta" value="${hasta}" required></div>
      </div>
      <p class="pista" style="margin:-4px 0 12px">Si “hasta” es antes que “desde”, el turno acaba al día siguiente (p. ej. noche 22:00–08:00).</p>
      <div class="campo"><label>Nota (opcional)</label><input type="text" name="nota" value="${esc(t?.nota || '')}" placeholder="p. ej. llevo la comida"></div>
      ${nuevo ? `<div class="campo"><label>Repetir</label>
        <select name="repetir">
          <option value="1">No se repite</option>
          <option value="2">Cada semana · 2 semanas</option>
          <option value="3">Cada semana · 3 semanas</option>
          <option value="4">Cada semana · 4 semanas</option>
          <option value="6">Cada semana · 6 semanas</option>
          <option value="8">Cada semana · 8 semanas</option>
        </select></div>` : ''}
      <div class="acciones">
        ${nuevo ? '' : '<button type="button" class="btn peligro izq" data-borrar>Borrar</button>'}
        <button type="button" class="btn sec" data-cerrar>Cancelar</button>
        <button class="btn">Guardar</button>
      </div>`,
      async fd => {
        const ini = U.deFechaHora(fd.get('fecha'), fd.get('desde'));
        let fin = U.deFechaHora(fd.get('fecha'), fd.get('hasta'));
        if (!fd.get('fecha') || isNaN(ini) || isNaN(fin)) return 'Rellena el día y las horas.';
        if (fin <= ini) fin = U.addDays(fin, 1);
        const base = { persona: fd.get('persona'), nota: fd.get('nota').trim() || null };
        if (nuevo) {
          lsSet('cuidados_ult_turno', JSON.stringify({ desde: fd.get('desde'), hasta: fd.get('hasta') }));
          const n = +fd.get('repetir') || 1;
          const filas = [];
          for (let k = 0; k < n; k++) filas.push({ ...base, creado_por: S.persona, inicio: U.addDays(ini, 7 * k).toISOString(), fin: U.addDays(fin, 7 * k).toISOString() });
          return intentar(() => DB.insert('turnos', filas), n > 1 ? `${n} turnos apuntados` : 'Turno apuntado');
        }
        return intentar(() => DB.update('turnos', t.id, { ...base, inicio: ini.toISOString(), fin: fin.toISOString() }), 'Turno actualizado');
      },
      t && (() => intentar(() => DB.remove('turnos', t.id), 'Turno borrado')),
      '¿Borrar este turno?'
    );
  }

  // ======== MEDICACIÓN
  function tomasDelDia(fecha) {
    const items = [];
    DB.cache.medicamentos.filter(m => m.activo !== false).forEach(m =>
      (m.horas || []).forEach(h => items.push({ m, h })));
    return items.sort((a, b) => a.h.localeCompare(b.h) || a.m.nombre.localeCompare(b.m.nombre));
  }

  function listaTomas(fecha) {
    if (!DB.cache.medicamentos.length) {
      return `<div class="vacio">Aún no hay medicación apuntada.
        <button class="enlace" data-accion="ir" data-ir="medicacion">Añadir la pauta</button></div>`;
    }
    const items = tomasDelDia(fecha);
    if (!items.length) return '<div class="vacio">No hay tomas con hora para este día.</div>';
    const ahora = new Date(), hoy = U.ymd(ahora);
    return `<div>${items.map(({ m, h }) => {
      const tm = DB.cache.tomas.find(x => x.medicamento_id === m.id && x.fecha === fecha && x.hora === h);
      const pasada = fecha < hoy || (fecha === hoy && h <= U.hm(ahora));
      return `<button class="toma ${tm ? 'hecha' : ''} ${pasada ? 'pasada' : ''}" data-accion="toma" data-med="${esc(m.id)}" data-fecha="${esc(fecha)}" data-hora="${esc(h)}">
        <span class="check">${tm ? '✓' : ''}</span>
        <span class="hora">${esc(h)}</span>
        <span style="flex:1;min-width:0"><strong>${esc(m.nombre)}</strong> ${m.dosis ? `<span class="suave">${esc(m.dosis)}</span>` : ''}
          ${tm ? `<div class="quien">Dada por ${esc(U.persona(tm.persona).nombre)} a las ${U.hm(tm.created_at)}</div>` : ''}
          ${!tm && m.notas ? `<div class="pista">${esc(m.notas)}</div>` : ''}</span>
      </button>`;
    }).join('')}</div>`;
  }

  VISTAS.medicacion = function () {
    const f = S.diaMed, hoy = U.ymd(new Date());
    const meds = [...DB.cache.medicamentos].sort((a, b) => (b.activo !== false) - (a.activo !== false) || a.nombre.localeCompare(b.nombre));
    return `
      <div class="tit-vista"><h1>Medicación</h1><button class="btn" data-accion="med-nuevo">+ Medicamento</button></div>
      <section class="tarjeta">
        <div class="nav-semana" style="margin-bottom:10px">
          <button class="icono-btn" data-accion="med-dia" data-d="-1" aria-label="Día anterior">‹</button>
          <strong style="text-transform:capitalize">${U.diaRelativo(U.deFechaHora(f))}</strong>
          ${f !== hoy ? '<button class="btn sec mini" data-accion="med-dia" data-d="0">Hoy</button>' : ''}
          <button class="icono-btn" data-accion="med-dia" data-d="1" aria-label="Día siguiente">›</button>
        </div>
        ${listaTomas(f)}
      </section>
      <section class="tarjeta">
        <h2>Pauta</h2>
        ${meds.length ? `<ul class="lista">${meds.map(m => `
          <li class="med" ${m.activo === false ? 'style="opacity:.55"' : ''}>
            <div style="min-width:0">
              <strong>${esc(m.nombre)}</strong> ${m.dosis ? `<span class="suave">${esc(m.dosis)}</span>` : ''}
              ${m.activo === false ? '<span class="pista">(ya no la toma)</span>' : ''}
              <div class="horas-chips">${(m.horas || []).map(h => `<span>${esc(h)}</span>`).join('') || '<span>Sin hora fija</span>'}</div>
              ${m.notas ? `<div class="pista" style="margin-top:4px">${esc(m.notas)}</div>` : ''}
            </div>
            <button class="btn sec mini" data-accion="med-editar" data-id="${m.id}">Editar</button>
          </li>`).join('')}</ul>`
        : `<div class="vacio">Cuando tengáis la pauta (suele venir en el informe de alta), apuntad cada medicamento con sus horas. Así cada toma se puede marcar como dada y nadie la repite ni la olvida.</div>`}
      </section>`;
  };

  function formMed(m) {
    const nuevo = !m;
    const horas = m?.horas?.length ? m.horas : ['09:00'];
    const filaHora = h => `<div class="h-fila"><input type="time" name="hora" value="${esc(h)}"><button type="button" class="icono-btn" data-quitar-hora aria-label="Quitar hora">×</button></div>`;
    modal(`
      <h2>${nuevo ? 'Nuevo medicamento' : 'Editar medicamento'}</h2>
      <div class="campo"><label>Nombre</label><input type="text" name="nombre" value="${esc(m?.nombre || '')}" required placeholder="p. ej. Omeprazol"></div>
      <div class="campo"><label>Dosis</label><input type="text" name="dosis" value="${esc(m?.dosis || '')}" placeholder="p. ej. 20 mg, 1 comprimido"></div>
      <div class="campo"><span class="lbl">Horas</span>
        <div class="horas-editor" id="horas-editor">${horas.map(filaHora).join('')}</div>
        <button type="button" class="enlace peq" data-anadir-hora style="align-self:flex-start;margin-top:4px">+ Añadir otra hora</button>
      </div>
      <div class="campo"><label>Notas</label><input type="text" name="notas" value="${esc(m?.notas || '')}" placeholder="p. ej. con el desayuno, en ayunas…"></div>
      ${nuevo ? '' : `<label style="display:flex;gap:8px;align-items:center;margin-bottom:12px">
        <input type="checkbox" name="activo" ${m.activo !== false ? 'checked' : ''} style="width:20px;height:20px"> La sigue tomando</label>`}
      <div class="acciones">
        ${nuevo ? '' : '<button type="button" class="btn peligro izq" data-borrar>Borrar</button>'}
        <button type="button" class="btn sec" data-cerrar>Cancelar</button>
        <button class="btn">Guardar</button>
      </div>`,
      async fd => {
        const nombre = fd.get('nombre').trim();
        if (!nombre) return 'Pon el nombre del medicamento.';
        const horasV = [...new Set(fd.getAll('hora').filter(Boolean))].sort();
        const fila = { nombre, dosis: fd.get('dosis').trim() || null, horas: horasV, notas: fd.get('notas').trim() || null };
        if (nuevo) return intentar(() => DB.insert('medicamentos', { ...fila, activo: true }), 'Medicamento añadido');
        return intentar(() => DB.update('medicamentos', m.id, { ...fila, activo: fd.get('activo') === 'on' }), 'Guardado');
      },
      m && (() => intentar(() => DB.remove('medicamentos', m.id), 'Medicamento borrado')),
      '¿Borrar este medicamento y su historial de tomas? Si solo ha dejado de tomarlo, mejor desmarca “La sigue tomando”.'
    );
    const form = $('#modal-form');
    form.querySelector('[data-anadir-hora]').onclick = () => {
      $('#horas-editor').insertAdjacentHTML('beforeend', filaHora(''));
      $('#horas-editor').lastElementChild.querySelector('input').focus();
    };
    form.addEventListener('click', e => { const q = e.target.closest('[data-quitar-hora]'); if (q) q.parentElement.remove(); });
  }

  async function toggleToma(medId, fecha, hora) {
    const tm = DB.cache.tomas.find(x => x.medicamento_id === medId && x.fecha === fecha && x.hora === hora);
    const m = DB.cache.medicamentos.find(x => x.id === medId);
    if (tm) {
      if (!confirm(`¿Desmarcar ${m?.nombre || ''} de las ${hora}? La marcó ${U.persona(tm.persona).nombre}.`)) return;
      return intentar(() => DB.remove('tomas', tm.id));
    }
    return intentar(() => DB.insert('tomas', { medicamento_id: medId, fecha, hora, persona: S.persona }), `✓ ${m?.nombre || 'Toma'} marcada`);
  }

  // ======== DIARIO
  const ordenNotas = () => [...DB.cache.notas].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  function itemNota(n) {
    const [ico, nom] = TIPOS_NOTA[n.tipo] || TIPOS_NOTA.general;
    return `<li class="nota-item">
      <div class="meta">${U.chip(n.persona)}<span>${ico} ${nom}</span><span>· ${S.vista === 'diario' ? '' : U.diaRelativo(n.created_at) + ' '}${U.hm(n.created_at)}</span>
        <span style="flex:1"></span>
        ${S.vista === 'diario' ? `<button class="borrar" data-accion="nota-borrar" data-id="${n.id}" aria-label="Borrar nota">×</button>` : ''}</div>
      <div class="texto">${esc(n.texto)}</div>
    </li>`;
  }

  VISTAS.diario = function () {
    const notas = ordenNotas().slice(0, 150);
    let lista = '', diaAnt = '';
    notas.forEach(n => {
      const d = U.ymd(n.created_at);
      if (d !== diaAnt) {
        if (diaAnt) lista += '</ul></section>';
        lista += `<div class="dia-sep">${U.diaRelativo(n.created_at) === U.diaCorto(n.created_at) ? U.diaLargo(n.created_at) : U.diaRelativo(n.created_at)}</div><section class="tarjeta"><ul class="lista">`;
        diaAnt = d;
      }
      lista += itemNota(n);
    });
    if (diaAnt) lista += '</ul></section>';
    return `
      <div class="tit-vista"><h1>Diario</h1></div>
      <section class="tarjeta">
        <div class="tipos">${Object.entries(TIPOS_NOTA).map(([k, [ico, nom]]) =>
          `<button class="tipo-btn ${S.tipoNota === k ? 'sel' : ''}" data-accion="nota-tipo" data-tipo="${k}">${ico} ${nom}</button>`).join('')}</div>
        <textarea id="nota-texto" data-borrador="nota" placeholder="¿Cómo está? Comida, sueño, tensión, ánimo, lo que haya pasado…"></textarea>
        <div class="acciones" style="margin-top:8px"><button class="btn" data-accion="nota-guardar">Guardar nota</button></div>
      </section>
      ${lista || '<div class="vacio">Todavía no hay notas. La primera, para el siguiente turno 🙂</div>'}`;
  };

  // ======== AGENDA
  const ordenTareas = arr => [...arr].sort((a, b) =>
    (a.fecha || '9999').localeCompare(b.fecha || '9999') || (a.hora || '99').localeCompare(b.hora || '99') || new Date(a.created_at) - new Date(b.created_at));

  function itemTarea(t) {
    const hoy = U.ymd(new Date());
    let meta = '';
    if (t.fecha) {
      const urg = !t.hecha && t.fecha <= hoy;
      meta = `<div class="t-meta ${urg ? 'urgente' : ''}">${t.tipo === 'cita' ? '📅 ' : ''}${U.diaRelativo(U.deFechaHora(t.fecha))}${t.hora ? ' · ' + esc(t.hora) : ''}${!t.hecha && t.fecha < hoy ? ' (pasada)' : ''}</div>`;
    }
    if (t.hecha && t.hecha_por) meta += `<div class="t-meta">Hecho por ${esc(U.persona(t.hecha_por).nombre)}</div>`;
    return `<li class="tarea ${t.hecha ? 'hecha' : ''}">
      <button class="check-t" data-accion="tarea-toggle" data-id="${t.id}" aria-label="Marcar como hecha">${t.hecha ? '✓' : ''}</button>
      <div class="t-cuerpo" data-accion="tarea-editar" data-id="${t.id}"><div class="t-tit">${esc(t.titulo)}</div>${meta}</div>
    </li>`;
  }

  VISTAS.agenda = function () {
    const hoy = U.ymd(new Date());
    const citas = ordenTareas(DB.cache.tareas.filter(t => t.tipo === 'cita' && (!t.hecha || (t.fecha && t.fecha >= hoy))));
    const tareas = ordenTareas(DB.cache.tareas.filter(t => t.tipo === 'tarea' && !t.hecha));
    const hechas = DB.cache.tareas.filter(t => t.tipo === 'tarea' && t.hecha)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 5);
    const compra = DB.cache.tareas.filter(t => t.tipo === 'compra').sort((a, b) => a.hecha - b.hecha || new Date(a.created_at) - new Date(b.created_at));
    const tachados = compra.filter(c => c.hecha).length;
    return `
      <div class="tit-vista"><h1>Agenda</h1></div>
      <section class="tarjeta">
        <h2>📅 Citas <button class="btn mini" data-accion="tarea-nueva" data-tipo="cita">+ Cita</button></h2>
        ${citas.length ? `<ul class="lista">${citas.map(itemTarea).join('')}</ul>` : '<div class="vacio">Sin citas apuntadas (médico, análisis, curas…).</div>'}
      </section>
      <section class="tarjeta">
        <h2>✅ Tareas <button class="btn mini" data-accion="tarea-nueva" data-tipo="tarea">+ Tarea</button></h2>
        ${tareas.length ? `<ul class="lista">${tareas.map(itemTarea).join('')}</ul>` : '<div class="vacio">No hay tareas pendientes.</div>'}
        ${hechas.length ? `<details style="margin-top:8px"><summary class="suave peq">Hechas recientemente</summary><ul class="lista" style="margin-top:6px">${hechas.map(itemTarea).join('')}</ul></details>` : ''}
      </section>
      <section class="tarjeta">
        <h2>🛒 Lista de la compra ${tachados ? `<button class="enlace peq" data-accion="compra-limpiar">Quitar tachados</button>` : ''}</h2>
        <form class="h-fila" id="form-compra" style="display:flex;gap:8px;margin-bottom:8px">
          <input type="text" id="compra-txt" data-borrador="compra" placeholder="Añadir algo…" autocomplete="off">
          <button class="btn">Añadir</button>
        </form>
        ${compra.length ? `<ul class="lista">${compra.map(itemTarea).join('')}</ul>` : '<div class="vacio">La lista está vacía.</div>'}
      </section>`;
  };

  function formTarea(t, tipo) {
    const nuevo = !t;
    tipo = t?.tipo || tipo || 'tarea';
    const nombres = { cita: 'cita', tarea: 'tarea', compra: 'cosa de la compra' };
    modal(`
      <h2>${nuevo ? 'Nueva ' + nombres[tipo] : 'Editar'}</h2>
      <div class="campo"><label>${tipo === 'cita' ? '¿Qué cita?' : 'Qué hay que hacer'}</label>
        <input type="text" name="titulo" value="${esc(t?.titulo || '')}" required placeholder="${tipo === 'cita' ? 'p. ej. Cardiólogo, Hospital…' : 'p. ej. Recoger recetas'}"></div>
      <div class="campo"><label>Tipo</label>
        <select name="tipo">${['cita', 'tarea', 'compra'].map(k => `<option value="${k}" ${k === tipo ? 'selected' : ''}>${{ cita: 'Cita', tarea: 'Tarea', compra: 'Compra' }[k]}</option>`).join('')}</select></div>
      <div class="fila">
        <div class="campo"><label>Día ${tipo === 'cita' ? '' : '(opcional)'}</label><input type="date" name="fecha" value="${esc(t?.fecha || '')}"></div>
        <div class="campo"><label>Hora (opcional)</label><input type="time" name="hora" value="${esc(t?.hora || '')}"></div>
      </div>
      <div class="acciones">
        ${nuevo ? '' : '<button type="button" class="btn peligro izq" data-borrar>Borrar</button>'}
        <button type="button" class="btn sec" data-cerrar>Cancelar</button>
        <button class="btn">Guardar</button>
      </div>`,
      async fd => {
        const titulo = fd.get('titulo').trim();
        if (!titulo) return 'Escribe qué es.';
        const fila = { titulo, tipo: fd.get('tipo'), fecha: fd.get('fecha') || null, hora: fd.get('hora') || null };
        if (nuevo) return intentar(() => DB.insert('tareas', { ...fila, hecha: false, creado_por: S.persona }), 'Apuntado');
        return intentar(() => DB.update('tareas', t.id, fila), 'Guardado');
      },
      t && (() => intentar(() => DB.remove('tareas', t.id), 'Borrado')),
      '¿Borrar?'
    );
  }

  // ======== CONTACTOS
  VISTAS.contactos = function () {
    const cs = [...DB.cache.contactos].sort((a, b) => (a.orden ?? 100) - (b.orden ?? 100) || a.nombre.localeCompare(b.nombre));
    return `
      <div class="tit-vista"><h1>Contactos</h1><button class="btn" data-accion="contacto-nuevo">+ Añadir</button></div>
      <section class="tarjeta">
        ${cs.length ? `<ul class="lista">${cs.map(c => `
          <li class="contacto">
            <div class="c-cuerpo" data-accion="contacto-editar" data-id="${c.id}">
              <strong>${esc(c.nombre)}</strong>
              <div class="c-rol">${esc(c.rol || '')}${c.rol && c.telefono ? ' · ' : ''}${esc(c.telefono || '')}</div>
            </div>
            ${c.telefono ? `<a class="llamar" href="tel:${esc(c.telefono.replace(/[^\d+]/g, ''))}">📞 Llamar</a>` : ''}
          </li>`).join('')}</ul>` : '<div class="vacio">Añadid médico de cabecera, centro de salud, farmacia, familiares…</div>'}
      </section>
      <p class="pista" style="text-align:center">Toca un contacto para editarlo.</p>`;
  };

  function formContacto(c) {
    const nuevo = !c;
    modal(`
      <h2>${nuevo ? 'Nuevo contacto' : 'Editar contacto'}</h2>
      <div class="campo"><label>Nombre</label><input type="text" name="nombre" value="${esc(c?.nombre || '')}" required></div>
      <div class="campo"><label>Teléfono</label><input type="tel" name="telefono" value="${esc(c?.telefono || '')}"></div>
      <div class="campo"><label>Qué es (opcional)</label><input type="text" name="rol" value="${esc(c?.rol || '')}" placeholder="p. ej. Médica de cabecera, farmacia…"></div>
      <div class="campo"><label>Orden en la lista</label><input type="number" name="orden" value="${c?.orden ?? 10}"></div>
      <div class="acciones">
        ${nuevo ? '' : '<button type="button" class="btn peligro izq" data-borrar>Borrar</button>'}
        <button type="button" class="btn sec" data-cerrar>Cancelar</button>
        <button class="btn">Guardar</button>
      </div>`,
      async fd => {
        const nombre = fd.get('nombre').trim();
        if (!nombre) return 'Pon un nombre.';
        const fila = { nombre, telefono: fd.get('telefono').trim() || null, rol: fd.get('rol').trim() || null, orden: +fd.get('orden') || 10 };
        if (nuevo) return intentar(() => DB.insert('contactos', fila), 'Contacto añadido');
        return intentar(() => DB.update('contactos', c.id, fila), 'Guardado');
      },
      c && (() => intentar(() => DB.remove('contactos', c.id), 'Contacto borrado')),
      '¿Borrar este contacto?'
    );
  }

  // ------------------------------------------------------------------ modal genérico
  function modal(html, alGuardar, alBorrar, textoBorrar = '¿Borrar?') {
    const dlg = $('#modal'), form = $('#modal-form');
    const nuevoForm = form.cloneNode(false); // quita listeners anteriores
    form.replaceWith(nuevoForm);
    nuevoForm.innerHTML = html + '<div class="error" id="modal-error" hidden></div>';
    nuevoForm.addEventListener('click', async e => {
      if (e.target.closest('[data-cerrar]')) dlg.close();
      if (e.target.closest('[data-borrar]') && alBorrar && confirm(textoBorrar)) { dlg.close(); await alBorrar(); }
    });
    nuevoForm.addEventListener('submit', async e => {
      e.preventDefault();
      const btn = nuevoForm.querySelector('button:not([type=button])');
      btn.disabled = true;
      const r = await alGuardar(new FormData(nuevoForm));
      btn.disabled = false;
      if (typeof r === 'string') { const er = $('#modal-error'); er.textContent = r; er.hidden = false; return; }
      if (r !== false) dlg.close();
    });
    dlg.showModal();
  }
  // cerrar tocando fuera
  $('#modal').addEventListener('click', e => { if (e.target.id === 'modal') e.target.close(); });

  // ------------------------------------------------------------------ eventos
  document.addEventListener('click', async e => {
    const nav = e.target.closest('[data-vista]');
    if (nav) { irA(nav.dataset.vista); return; }
    const el = e.target.closest('[data-accion]');
    if (!el) return;
    const d = el.dataset, buscar = (t) => DB.cache[t].find(x => x.id === d.id);
    switch (d.accion) {
      case 'ir': irA(d.ir); break;
      case 'cambiar-persona': pantallaPersona(); break;
      case 'salir': if (confirm('¿Cerrar sesión en este móvil?')) { await DB.salir(); location.reload(); } break;
      case 'demo-reiniciar': if (confirm('¿Borrar los datos de prueba y volver a los de ejemplo?')) DB.demoReiniciar(); break;

      case 'semana': S.semana = +d.d === 0 ? 0 : S.semana + +d.d; pintar(); window.scrollTo(0, 0); break;
      case 'turno-nuevo': formTurno(null, d.fecha); break;
      case 'turno-editar': formTurno(buscar('turnos')); break;

      case 'toma': toggleToma(d.med, d.fecha, d.hora); break;
      case 'med-dia': S.diaMed = +d.d === 0 ? U.ymd(new Date()) : U.ymd(U.addDays(U.deFechaHora(S.diaMed), +d.d)); pintar(); break;
      case 'med-nuevo': formMed(null); break;
      case 'med-editar': formMed(buscar('medicamentos')); break;

      case 'nota-tipo': S.tipoNota = d.tipo; guardarYPintar(); break;
      case 'nota-guardar': {
        const txt = ($('#nota-texto')?.value || '').trim();
        if (!txt) { App.aviso('Escribe algo primero'); return; }
        const ok = await intentar(() => DB.insert('notas', { persona: S.persona, tipo: S.tipoNota, texto: txt }), 'Nota guardada');
        if (ok) { borradores.nota = ''; S.tipoNota = 'general'; $('#nota-texto').value = ''; $('#nota-texto').blur(); pintar(); }
        break;
      }
      case 'nota-borrar': if (confirm('¿Borrar esta nota?')) intentar(() => DB.remove('notas', d.id), 'Nota borrada'); break;

      case 'tarea-nueva': formTarea(null, d.tipo); break;
      case 'tarea-editar': formTarea(buscar('tareas')); break;
      case 'tarea-toggle': {
        const t = buscar('tareas');
        intentar(() => DB.update('tareas', t.id, { hecha: !t.hecha, hecha_por: !t.hecha ? S.persona : null }));
        break;
      }
      case 'compra-limpiar':
        for (const c of DB.cache.tareas.filter(t => t.tipo === 'compra' && t.hecha)) await intentar(() => DB.remove('tareas', c.id));
        break;

      case 'contacto-nuevo': formContacto(null); break;
      case 'contacto-editar': formContacto(buscar('contactos')); break;
    }
  });

  // al cambiar de tipo de nota no perder lo escrito
  function guardarYPintar() { const ta = $('#nota-texto'); if (ta) borradores.nota = ta.value; document.activeElement?.blur?.(); pintar(); }

  document.addEventListener('submit', async e => {
    if (e.target.id !== 'form-compra') return;
    e.preventDefault();
    const inp = $('#compra-txt'), txt = inp.value.trim();
    if (!txt) return;
    inp.value = ''; borradores.compra = ''; inp.blur();
    await intentar(() => DB.insert('tareas', { titulo: txt, tipo: 'compra', hecha: false, creado_por: S.persona }));
    $('#compra-txt')?.focus();
  });

  function irA(v) {
    S.vista = v; lsSet('cuidados_vista', v);
    if (document.activeElement) document.activeElement.blur?.();
    pintar(); window.scrollTo(0, 0);
  }

  arrancar();
})();
