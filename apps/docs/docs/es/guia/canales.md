# Canales de entrada

Todo lo que llega a Seredina termina siendo un ticket, sin importar por
dónde entró — esa convergencia es literalmente lo que significa el nombre
del producto. Esta página cubre cómo configurar cada canal de entrada;
para notificaciones *salientes* (Slack, Teams, tu propio webhook), ver
[Webhooks salientes](/es/api/webhooks).

## Correo electrónico

**Ajustes → Canales de correo → Nuevo canal** ofrece tres tipos de
buzón:

- **Microsoft 365 / Outlook** y **Gmail / Google Workspace** — inicio de
  sesión con OAuth. Ambos proveedores desactivaron (o permiten a los
  administradores desactivar) IMAP/SMTP con contraseña, así que esta es la
  forma de conectar un buzón corporativo. Los servidores y puertos se
  completan solos.
- **Otro (IMAP/SMTP)** — cualquier proveedor que todavía acepte usuario y
  contraseña: credenciales IMAP para leer y SMTP para responder.

Todos los secretos (contraseñas, secreto del cliente OAuth, token de
renovación) se cifran en reposo con `ENCRYPTION_KEY` (AES-256-GCM) — nunca
se guardan en texto plano.

### Conectar Microsoft 365 o Gmail

Seredina no trae una app OAuth compartida: registras la tuya en tu cuenta
de Microsoft o Google (es gratis y toma unos minutos) y pegas su ID y
secreto de cliente en Seredina. El **URI de redirección** que debes
registrar aparece en el diálogo "Nuevo canal": es la dirección de tu
servidor seguida de `/api/email-channels/oauth/callback`, por lo que
`WEB_ORIGIN` (o `API_PUBLIC_URL`) debe tener la dirección que se usa en el
navegador.

**Microsoft 365** (portal de Azure → Microsoft Entra ID → Registros de
aplicaciones):

1. **Nuevo registro** → cualquier nombre → tipos de cuenta "solo este
   directorio organizativo" → URI de redirección de plataforma **Web** =
   el URI que muestra Seredina.
2. **Permisos de API → Agregar → API que usa mi organización → Office 365
   Exchange Online → Delegados**: `IMAP.AccessAsUser.All` y `SMTP.Send`.
   Agrega también `offline_access` de Microsoft Graph. Pulsa **Conceder
   consentimiento de administrador**.
3. **Certificados y secretos → Nuevo secreto de cliente**; copia el *valor*.
4. Copia el **Id. de aplicación (cliente)** y el **Id. de directorio
   (inquilino)** desde la página de información general.
5. Verifica que el buzón tenga **SMTP autenticado** habilitado (Centro de
   administración de Microsoft 365 → usuario → Correo → Administrar
   aplicaciones de correo).

**Gmail / Google Workspace** (consola de Google Cloud):

1. Crea (o elige) un proyecto y **habilita la API de Gmail**.
2. **Pantalla de consentimiento OAuth**: tipo de usuario *Interno* para
   Workspace (para una cuenta Gmail personal usa *Externo* y agrégate como
   usuario de prueba); agrega el alcance `https://mail.google.com/`.
3. **Credenciales → Crear credenciales → ID de cliente OAuth → Aplicación
   web**, agrega el URI de redirección que muestra Seredina y copia el ID y
   el secreto de cliente.

Luego en Seredina elige el proveedor, escribe la dirección del buzón, el ID
y el secreto de cliente (y en Microsoft, opcionalmente, el ID de
directorio) y pulsa **Guardar e iniciar sesión**. Inicia sesión *con la
cuenta del buzón* y acepta; vuelves a la página de canales con el canal
**Conectado**.

Si el proveedor revoca el acceso más adelante (cambio de contraseña, un
administrador quitó la app, el secreto venció), el canal pasa a **Requiere
reconexión** con el motivo, deja de revisarse, y el enlace **reconectar**
vuelve a iniciar la sesión.

### Cómo se procesa el correo

El worker revisa cada buzón conectado por polling (cada
`EMAIL_POLL_INTERVAL_MS`, 30 segundos por defecto) — no es una suscripción
push. Un correo nuevo de un remitente desconocido crea un ticket; una
respuesta a un hilo existente se agrega como mensaje al ticket
correspondiente. Los adjuntos se guardan en el ticket (hasta 5 por correo,
8 MB cada uno — lo que no cabe se menciona en una nota del mensaje), y las
respuestas salen desde el mismo buzón al que escribió el cliente. Si un buzón no logra iniciar sesión, el error aparece en
la página de canales de correo.

### Correos a tus clientes

Todo lo que un cliente recibe por correo usa el logo y el color de
**Marca**. Eso incluye las respuestas de los agentes, el acuse de recibo, el
aviso de solicitud resuelta con su encuesta de satisfacción y los enlaces de
acceso al portal. Va escrito en el idioma de tu empresa, con una línea chica
"Powered by Seredina" debajo del mensaje.

Configúralo en **Ajustes → Correos al cliente**:

- **Idioma de los correos**: español (por defecto) o inglés. Todo lo que
  Seredina escribe por ti sale en ese idioma: los textos predeterminados,
  los botones, el pie, los correos de acceso y contraseña, y los avisos a
  tus agentes.
- **Nombre del remitente**: el que aparece en el De, por ejemplo
  *Soporte TI &lt;soporte@tuempresa.cl&gt;*. Vacío usa el nombre de tu empresa.
- **Logo** y **banner**: sube un PNG, JPG o GIF (hasta 2 MB), o pega la
  dirección de una imagen publicada en otro lado. El logo va arriba de
  cada correo; si no subes uno, se usa el de Marca. El banner es una imagen
  ancha debajo del logo: se recomienda de 1200 × 400 px, se muestra a 600 px
  de ancho y puede llevar un enlace.
- **Firma de la empresa**: va debajo de cada correo: equipo, teléfono,
  horario.
- **Citar el último mensaje del cliente** bajo cada respuesta, y sumar la
  **encuesta de satisfacción** al correo de solicitud resuelta.

Cada correo automático tiene su propia tarjeta:

| Correo | Se envía cuando | Activado por defecto |
| --- | --- | --- |
| Acuse de recibo | Un cliente abre una solicitud por correo, en el portal o en el catálogo | Sí |
| Respuesta de un agente | Un agente responde en forma pública | Siempre |
| Solicitud resuelta | La solicitud pasa a un estado resuelto | Sí |
| Solicitud cerrada | La solicitud se cierra | No |

::: v-pre
Edita el asunto y el mensaje de cada tarjeta con variables como
`{{contact.name}}`, `{{ticket.number}}` o `{{ticket.subject}}`; con un clic
se insertan. **Vista previa** muestra el correo con datos de ejemplo, y
**Enviarme una prueba** lo manda a tu propia dirección. **Restaurar
predeterminada** deshace tus cambios.
:::

Cada agente pone su propia firma en **Seguridad de la cuenta**.

::: tip Las imágenes necesitan una dirección que tus clientes alcancen
Los programas de correo cargan el logo y el banner desde el `WEB_ORIGIN` de
tu servidor. Si Seredina solo es accesible dentro de la red de tu empresa,
los clientes de afuera no van a ver las imágenes subidas. Usa una dirección
pública, o pega la URL de una imagen publicada en tu sitio web.
:::

Las respuestas de fuera de oficina, los rebotes y las listas de correo
igual crean tickets, pero nunca reciben acuse de recibo, así dos respuestas
automáticas no se contestan entre sí para siempre.

## API

Para integraciones propias — tu sitio, un script, cualquier sistema que
pueda hacer un `POST`. Ver [API REST](/es/api/rest-api) para el detalle
técnico completo con ejemplos.

## Widget de chat embebible

Un `<script>` que convierte cualquier página web en un canal de chat, sin
cuenta ni credencial de por medio. Ver
[Widget embebible](/es/api/widget).

## Telegram

**Ajustes → Telegram** — conecta tu propio bot (creado con
[@BotFather](https://t.me/BotFather)) pegando su token. Un mensaje directo
al bot crea un ticket; el agente responde desde la consola como cualquier
otro canal, y la respuesta llega al usuario por Telegram.

::: warning Requiere una URL pública real
Telegram entrega mensajes llamando directamente a tu API — necesitas
`API_PUBLIC_URL` configurada con una dirección HTTPS real y alcanzable
desde internet. `localhost` no funciona para este canal en particular. Ver
[Variables de entorno](/es/despliegue/variables-de-entorno#red-y-puertos).
:::

## Alertas de monitoreo (NOC/SOC)

**Ajustes → Integraciones de Monitoreo** trae instrucciones
listas para copiar y pegar para conectar:

- **Grafana Alerting** — un "contact point" tipo webhook apuntando a
  `/v1/alerts/grafana`, que acepta el payload nativo de Grafana sin
  transformación.
- **Zabbix** — un script de acción/notificación que llama al endpoint
  genérico `/v1/alerts`.

Ambos convierten una alerta que dispara en un ticket, con la severidad de
la alerta mapeada a una prioridad de ticket. Es el mismo mecanismo
genérico documentado en [API REST](/es/api/rest-api#post-v1-alerts) — no hace
falta una integración de backend específica por cada herramienta de
monitoreo nueva, cualquiera que pueda mandar un `POST` con un token
Bearer sirve.
