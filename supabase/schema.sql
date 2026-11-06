-- =====================================================================
--  Cuidados Abuela · esquema de base de datos para Supabase
--  Pegar entero en: Supabase > SQL Editor > New query > Run
--  Se puede ejecutar más de una vez sin romper nada.
-- =====================================================================

-- ---------- Turnos (franjas libres: inicio y fin con fecha y hora) ----------
create table if not exists turnos (
  id          uuid primary key default gen_random_uuid(),
  persona     text not null,
  inicio      timestamptz not null,
  fin         timestamptz not null,
  nota        text,
  creado_por  text,
  created_at  timestamptz not null default now(),
  constraint turnos_fin_despues check (fin > inicio)
);
create index if not exists turnos_inicio_idx on turnos (inicio);

-- ---------- Diario de cuidados ----------
create table if not exists notas (
  id          uuid primary key default gen_random_uuid(),
  persona     text not null,
  tipo        text not null default 'general',   -- general | comida | sueno | salud | animo
  texto       text not null,
  created_at  timestamptz not null default now()
);
create index if not exists notas_created_idx on notas (created_at desc);

-- ---------- Medicación ----------
create table if not exists medicamentos (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null,
  dosis       text,
  horas       text[] not null default '{}',      -- p.ej. {"09:00","21:00"}
  notas       text,
  activo      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists tomas (
  id              uuid primary key default gen_random_uuid(),
  medicamento_id  uuid not null references medicamentos(id) on delete cascade,
  fecha           date not null,
  hora            text not null,
  persona         text not null,
  created_at      timestamptz not null default now(),
  unique (medicamento_id, fecha, hora)
);

-- ---------- Agenda: citas, tareas, compra ----------
create table if not exists tareas (
  id          uuid primary key default gen_random_uuid(),
  titulo      text not null,
  tipo        text not null default 'tarea',     -- cita | tarea | compra
  fecha       date,
  hora        text,
  hecha       boolean not null default false,
  hecha_por   text,
  creado_por  text,
  created_at  timestamptz not null default now()
);

-- ---------- Contactos ----------
create table if not exists contactos (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null,
  telefono    text,
  rol         text,
  orden       int not null default 100,
  created_at  timestamptz not null default now()
);

-- =====================================================================
--  Seguridad: solo usuarios con sesión iniciada (la cuenta familiar)
--  pueden leer o escribir. Sin contraseña no se ve nada.
-- =====================================================================
do $$
declare t text;
begin
  foreach t in array array['turnos','notas','medicamentos','tomas','tareas','contactos'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "familia" on %I', t);
    execute format(
      'create policy "familia" on %I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- =====================================================================
--  Tiempo real: que los cambios aparezcan al momento en todos los móviles
-- =====================================================================
do $$
declare t text;
begin
  foreach t in array array['turnos','notas','medicamentos','tomas','tareas','contactos'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table %I', t);
    end if;
  end loop;
end $$;

-- Contacto inicial de ejemplo (solo si no hay ninguno)
insert into contactos (nombre, telefono, rol, orden)
select 'Emergencias', '112', 'Urgencias', 1
where not exists (select 1 from contactos);
