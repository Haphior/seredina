# Actualizaciones y backups

## Actualizar tu instancia

Seredina no se actualiza sola: vos elegís cuándo. Cada versión es un tag
de git (`v0.2.0`, `v0.3.0`...), con sus notas en la
[página de versiones](https://github.com/Haphior/helpdesk-seredina/releases).
Un servidor en producción debería correr una versión, no lo que tenga
`main` hoy.

### Qué versión está corriendo

```bash
curl -s https://<tu dirección>/api/health     # {"status":"ok","version":"0.2.0"}
git -C /opt/seredina describe --tags            # v0.2.0
```

### Actualizar a una versión nueva

1. **Leé las notas de la versión.** Dicen qué cambió y si hay algo que
   hacer a mano. Leé también las de cada versión que te saltes.
2. **Hacé un backup** de la base de datos, y tené a mano tu copia del
   `.env` (ver [Backups](#backups)):

   ```bash
   docker compose -f infra/docker-compose.yml exec -T postgres \
     pg_dump -U app_migrator -Fc seredina > antes-de-v0.3.0.dump
   ```

3. **Cambiá a la versión y reconstruí:**

   ```bash
   git fetch --tags
   git checkout v0.3.0
   docker compose -f infra/docker-compose.yml up -d --build
   ```

   El servicio `migrate` corre primero y aplica las migraciones nuevas
   antes de que `api` reciba tráfico. No hay un paso de migración aparte.
   Contá con uno o dos minutos sin servicio mientras se reinician los
   contenedores: hacelo fuera del horario de trabajo.
4. **Verificá:** `/api/health` muestra la versión nueva, y podés iniciar
   sesión.

Si instalaste desde `main` antes de que existieran las versiones,
`git checkout v0.2.0` te pasa a la primera. Desde ahí, seguí los pasos
de arriba.

### Volver atrás

Las migraciones solo avanzan, así que volver a una versión anterior
significa volver también a la base de datos de antes de actualizar:

```bash
git checkout v0.2.0
docker compose -f infra/docker-compose.yml down
docker volume rm infra_postgres_data        # el nombre que muestra `docker volume ls`
docker compose -f infra/docker-compose.yml up -d postgres
docker compose -f infra/docker-compose.yml exec -T postgres \
  pg_restore -U app_migrator -d seredina --no-owner --no-privileges < antes-de-v0.3.0.dump
docker compose -f infra/docker-compose.yml up -d --build
```

Lo que se haya registrado después del backup se pierde. Por eso el
backup va justo antes de actualizar.

### Actualizar los agentes

Los agentes tienen sus propias versiones
([Haphior/seredina-agent](https://github.com/Haphior/seredina-agent/releases)),
y las versiones del agente y del servidor no tienen que coincidir. En un
equipo, como administrador/root:

```bash
seredina-agent update --check    # ¿hay un agente más nuevo?
seredina-agent update            # instalarlo; no hace falta token de inscripción
```

En Windows el agente está en `C:\Program Files\Seredina Agent\seredina-agent.exe`.

`update` conserva la inscripción del equipo y su intervalo de reporte.
Verifica el SHA-256 de la descarga, y no hace nada si el agente ya está
al día. Así que podés correrlo en todos tus equipos desde Intune, un
script de inicio por GPO, Jamf o Ansible.

## Backups

Seredina no trae backups automatizados — es un Postgres estándar corriendo
en un contenedor, y las herramientas estándar de Postgres son las que
usás.

```bash
# Backup completo, en el formato comprimido propio de Postgres. Correlo
# desde la raíz del repositorio. El -T importa: sin él docker asigna una
# terminal y puede corromper la salida binaria.
docker compose -f infra/docker-compose.yml exec -T postgres \
  pg_dump -U app_migrator -Fc seredina > seredina-$(date +%Y%m%d-%H%M).dump
```

Programalo con cron (o con el mecanismo de backup de tu proveedor) y
copiá el archivo **fuera de la máquina** — un backup en el mismo disco que
la base de datos no sobrevive a ese disco. Por ejemplo, todas las noches a
las 02:30 guardando 14 días:

```text
30 2 * * * cd /opt/seredina && docker compose -f infra/docker-compose.yml exec -T postgres pg_dump -U app_migrator -Fc seredina > /var/backups/seredina/seredina-$(date +\%Y\%m\%d).dump && find /var/backups/seredina -name '*.dump' -mtime +14 -delete
```

Si Postgres no corre en este compose (una base administrada), usá los
snapshots de tu proveedor o apuntá el mismo `pg_dump` a esa base.

### Restaurar

Restaurá sobre una base de datos **vacía** y dejá que `migrate` termine el
trabajo: recrea el rol `app_tenant` con la contraseña de tu `.env` y vuelve
a aplicar las políticas de seguridad por fila y los permisos, que no
forman parte de un volcado de tablas.

```bash
# 1. Detené todo, vaciá solo el volumen de la base de datos, levantá solo Postgres.
docker compose -f infra/docker-compose.yml down
docker volume rm infra_postgres_data        # el nombre que muestra `docker volume ls`
docker compose -f infra/docker-compose.yml up -d postgres

# 2. Cargá el volcado.
docker compose -f infra/docker-compose.yml exec -T postgres \
  pg_restore -U app_migrator -d seredina --no-owner --no-privileges < seredina-20260101-0230.dump

# 3. Levantá el resto; migrate corre primero, como en cada arranque.
docker compose -f infra/docker-compose.yml up -d
```

`docker volume rm` borra la base de datos actual. Correlo solo cuando de
verdad quieras reemplazar esos datos. No uses `down -v` en su lugar:
también borra `caddy_data`, y con el modo TLS `internal` se generaría una
CA nueva, así que los navegadores y todos los agentes dejarían de confiar
en el servidor. Probá restaurar en una
máquina de prueba de vez en cuando: un backup que nunca restauraste es una
suposición, no un backup.

Los backups también conservan los datos personales que después se
[anonimizaron](/es/guia/contactos-y-datos-personales) en la base en uso,
hasta que se rotan. Guardalos solo el tiempo que los necesites.

### Lo que también necesitás respaldar

Un volcado de la base de datos **no alcanza por sí solo**. Guardá una copia
de tu `.env` en un lugar seguro y separado de los volcados — en especial:

- **`ENCRYPTION_KEY`**: cifra (AES-256-GCM) todos los secretos guardados:
  contraseñas de canales de correo y tokens OAuth de Gmail/Microsoft 365,
  secretos de cliente de SSO, secretos de MFA de los usuarios, claves de
  proveedores de IA, secretos de firma de webhooks y tokens de bots de
  Telegram. Si restaurás la base con otra clave, todo eso queda ilegible
  para siempre: hay que reconectar los buzones, reconfigurar el SSO y
  **un administrador tiene que restablecer el MFA de cada usuario**.
  Guardala como la contraseña de la base de datos misma — y nunca en el
  mismo lugar que los volcados, o con un solo backup robado alcanza para
  leer todos los secretos.
- **`JWT_SECRET`**: si lo perdés, no perdés datos, pero cada sesión activa
  queda inválida — no es catastrófico, solo molesto.
- **`APP_TENANT_DB_PASSWORD`** y **`POSTGRES_PASSWORD`**: no hacen falta
  para leer el volcado, pero restaurar con el mismo `.env` evita sorpresas.
- Si usás el perfil `proxy` con tu propio certificado, los archivos de
  `certs/`. Los certificados de Let's Encrypt se vuelven a emitir solos.

### Exportación de datos por tenant

Aparte del backup de infraestructura, cada tenant tiene su propia
exportación completa en un formato abierto: **Configuración → Exportar
Datos** en la consola (o `GET /export` directamente) devuelve un único
JSON con las ~35 tablas propias de ese tenant. Es la respuesta honesta al
"portabilidad de datos": migrar *fuera* de Seredina es un clic, no un
proceso deliberadamente doloroso como en otras herramientas cuyo modelo de
negocio depende de que te cueste irte. Los secretos (hashes de
contraseñas, claves de API, credenciales cifradas) se excluyen siempre del
export — nunca viajan fuera de la base de datos.

Esto es portabilidad de datos por tenant, no un reemplazo de un backup real
de infraestructura — usalo para migrar o auditar, no como tu única copia de
seguridad.
