# Primeros pasos

Esta guía cubre la consola de agentes: cómo usar cada funcionalidad desde
adentro, una vez que ya tienes una instancia corriendo. Si todavía no
instalaste Seredina, empieza por
[Instalación con Docker](/es/despliegue/).

## Crear tu organización

Visita `/register` en tu instancia y completa el formulario — slug de
organización, tu nombre, email y contraseña. Ese primer registro te
convierte automáticamente en administrador; no hay un paso de bootstrap
por línea de comandos separado.

::: tip Un solo registro en modo autoalojado
Si tu instancia corre en `SEREDINA_MODE=self_hosted` (el modo por
defecto), solo se puede registrar una organización — es intencional, ver
[Modo cloud](/es/despliegue/modo-cloud) si necesitas más de una.
:::

## El checklist de primeros pasos

Al entrar por primera vez, el panel muestra un widget "Primeros pasos"
con cuatro tareas: personalizar tus estados de tickets, definir una
política de SLA, crear una macro, e invitar a un compañero de equipo. No
es obligatorio completarlo en orden — es una guía, no un flujo forzado, y
se puede ocultar en cualquier momento con el ícono de ojo en la esquina
del widget.

## Invitar a tu equipo

Desde **Ajustes → Usuarios**, invita a cada persona por correo para
que elija su propia contraseña (necesita un canal de correo conectado), o
crea la cuenta con una contraseña inicial y compártela tú. Ver
[Usuarios y roles](/es/guia/administracion#usuarios-y-roles).

Con el [inicio de sesión único](/es/guia/administracion#inicio-de-sesion-unico-sso)
y la creación automática de cuentas activados, no hace falta crear
cuentas: cada persona entra con su cuenta de Microsoft o Google y recibe
el rol que elegiste.

## Cómo está organizada esta guía

En la consola, la barra lateral tiene el trabajo del día a día (tickets,
contactos, procesos, la base de conocimiento y el CMDB). Todo lo que
configura la organización está en **Ajustes**, al final de la barra
lateral, agrupado y con buscador. En el teléfono, la barra lateral se abre
con el botón de menú de arriba.

Los capítulos de esta guía:

- **[Tickets](/es/guia/tickets)** — la cola, el detalle, macros, fusión, acciones en lote
- **[SLA y escalamiento](/es/guia/sla-y-escalamiento)**
- **[CMDB y activos](/es/guia/cmdb-y-activos)** — activos, dispositivos con agente, contratos y garantías, catálogo de equipos
- **[Base de conocimiento](/es/guia/base-de-conocimiento)**
- **[Catálogo de servicios](/es/guia/catalogo-de-servicios)**
- **[Procesos, cambios y problemas](/es/guia/procesos-y-plantillas)**
- **[Copiloto de IA](/es/guia/copiloto-de-ia)**
- **[Canales de entrada](/es/guia/canales)** — correo, API, widget, Telegram, Slack/Teams, alertas
- **[Reportes y panel](/es/guia/reportes-y-panel)**
- **[Encuestas CSAT](/es/guia/encuestas-csat)**
- **[Administración](/es/guia/administracion)** — usuarios, roles, inicio de sesión único, verificación en dos pasos, registro de auditoría, claves de API, apariencia, idioma
- **[Portal público](/es/guia/portal-publico)** — portal de clientes, base de conocimiento pública y página de estado
- **[Contactos y datos personales](/es/guia/contactos-y-datos-personales)** — corregir, exportar y borrar los datos de un contacto, y retención automática
