# Windows Server con Docker Desktop

Los contenedores de Seredina son contenedores Linux, así que en Windows
corren sobre el motor WSL 2 de Docker Desktop. Todo lo de
[Producción en un servidor de la empresa](/es/despliegue/servidor-interno)
sigue valiendo. Esta página cubre solo lo que cambia en Windows.

## 1. Lo que necesitas

- **Docker Desktop** con el motor WSL 2, en modo contenedores Linux (el
  que trae por defecto).
- **Git para Windows** ([git-scm.com](https://git-scm.com/download/win)).
  Trae **Git Bash**, con el `bash` y el `openssl` que usan los scripts de
  instalación. Todos los comandos de esta página se ejecutan en Git Bash.
- Una IP fija para el servidor y, idealmente, un nombre en tu DNS interno
  (ver [Un nombre para el servidor](/es/despliegue/servidor-interno#_2-un-nombre-para-el-servidor)).

::: warning Docker Desktop arranca cuando alguien inicia sesión
Docker Desktop, y con él Seredina, solo corre mientras hay un usuario con
sesión iniciada en el servidor. Para que vuelva solo después de un
reinicio:

- activa **Settings → General → Start Docker Desktop when you sign in**;
- haz que esa cuenta inicie sesión automáticamente, o deja su sesión
  abierta (desconéctate del Escritorio remoto en vez de cerrar sesión).

Los contenedores se reinician solos cuando Docker está arriba.
:::

## 2. Revisa qué puertos están libres

Seredina usa estos puertos en el servidor:

| Puerto | Para | Expuesto a la red |
|---|---|---|
| 443 y 80 | La entrada HTTPS | Sí |
| 8080 | Consola | Solo hasta activar HTTPS |
| 4000 | API | Solo hasta activar HTTPS |
| 5432, 6379 | Postgres, Redis | No, solo `127.0.0.1` |

En la lista **Containers** de Docker Desktop, revisa la columna
**Port(s)** de tus otros contenedores. Si algo ya usa 80 o 443, o 5432 o
6379 (otra base de datos), elige otros puertos en el paso 4.

## 3. Instalar

En Git Bash, en la carpeta donde guardas tus proyectos de Docker (aquí
`C:\DockerData`):

```bash
cd /c/DockerData
git clone --branch v0.3.1 https://github.com/Haphior/seredina.git seredina
cd seredina
./scripts/setup.sh
```

`setup.sh` escribe `.env` con secretos aleatorios. **Copia `.env` a un
lugar seguro, fuera de este servidor** (un gestor de contraseñas). Sin su
`ENCRYPTION_KEY`, un backup no se puede restaurar con los buzones, el
inicio de sesión único y la verificación en dos pasos intactos.

::: tip Saltos de línea
Desde la v0.3.1 las versiones fuerzan saltos de línea Unix al clonar. Si
no, Git para Windows convierte los scripts a saltos de Windows y fallan
dentro de los contenedores con errores como `/bin/bash^M: bad interpreter`.
Para una versión anterior, clona con `git clone -c core.autocrlf=false ...`.
:::

## 4. Dirección, HTTPS y puertos

Si los puertos 80 o 443 estaban ocupados en el paso 2, primero define
otros en `.env`, por ejemplo:

```bash
sed -i 's/^HTTP_PORT=.*/HTTP_PORT=8081/; s/^HTTPS_PORT=.*/HTTPS_PORT=8443/' .env
```

Lo mismo con `POSTGRES_PORT` y `REDIS_PORT` si 5432 o 6379 están ocupados.

Después elige la dirección y el certificado, como en
[Certificado y dirección](/es/despliegue/servidor-interno#_4-certificado-y-direccion).
Con el nombre del servidor (recomendado) o su IP:

```bash
./scripts/configure-address.sh --address helpdesk.tuempresa.cl --tls internal
# o: --address 192.168.1.31 --tls internal
```

La dirección, incluido un puerto HTTPS no estándar, queda en `WEB_ORIGIN`
y `API_PUBLIC_URL`.

## 5. Arrancar

Cada comando `docker compose` en Windows agrega el archivo de Docker
Desktop `infra/docker-compose.desktop.yml` después del principal. Con él,
el worker usa la red normal de los contenedores en vez de la red del host,
que en Docker Desktop es la máquina virtual de Docker y no tu servidor.

```bash
docker compose --env-file .env -f infra/docker-compose.yml -f infra/docker-compose.desktop.yml up -d --build
docker compose --env-file .env -f infra/docker-compose.yml -f infra/docker-compose.desktop.yml ps
```

La primera compilación toma varios minutos. Después abre la dirección del
paso 4, registra tu organización y sigue la configuración inicial.

Para escribir menos, guarda los dos archivos en una variable de la sesión
de Git Bash:

```bash
export COMPOSE_FILE="infra/docker-compose.yml;infra/docker-compose.desktop.yml"
docker compose --env-file .env ps
```

## 6. Firewall de Windows

Permite el puerto HTTPS (y el 80, que solo redirige a HTTPS) desde tu red.
En PowerShell, como administrador:

```powershell
New-NetFirewallRule -DisplayName "Seredina HTTPS" -Direction Inbound -Protocol TCP -LocalPort 443 -RemoteAddress 192.168.0.0/16 -Action Allow
New-NetFirewallRule -DisplayName "Seredina HTTP"  -Direction Inbound -Protocol TCP -LocalPort 80  -RemoteAddress 192.168.0.0/16 -Action Allow
```

Usa tu propio rango de red y los puertos del paso 4.

## 7. Backups

La base de datos vive en un volumen de Docker dentro de Docker Desktop, no
en `C:\DockerData`. Vuélcala a un archivo:

```bash
mkdir -p /c/DockerData/backups
docker compose --env-file .env -f infra/docker-compose.yml -f infra/docker-compose.desktop.yml \
  exec -T postgres pg_dump -U app_migrator -Fc seredina > /c/DockerData/backups/seredina-$(date +%F).dump
```

Para que corra cada noche, guarda esas líneas como
`C:\DockerData\seredina-backup.sh`. Luego agrega en el Programador de
tareas una tarea que ejecute
`"C:\Program Files\Git\bin\bash.exe" -lc "cd /c/DockerData/seredina && /c/DockerData/seredina-backup.sh"`.

Copia los respaldos fuera del servidor también. Restaurar funciona como se
describe en [Backups](/es/despliegue/actualizaciones-y-backups#backups).

## 8. Actualizaciones

Igual que en [Actualizar a una versión nueva](/es/despliegue/actualizaciones-y-backups#actualizar-a-una-version-nueva),
agregando el archivo de Docker Desktop:

```bash
cd /c/DockerData/seredina
git fetch --tags
git checkout v0.3.1        # la versión nueva
docker compose --env-file .env -f infra/docker-compose.yml -f infra/docker-compose.desktop.yml up -d --build
```

Haz un backup antes, y revisa `https://<dirección>/api/health` después.
