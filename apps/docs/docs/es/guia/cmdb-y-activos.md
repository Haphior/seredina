# CMDB y activos

La CMDB de Seredina tiene tres pantallas relacionadas pero distintas:
**Activos** (el inventario en sí), **Dispositivos** (el agente de
endpoint que lo alimenta automáticamente), y **Catálogo de Equipos** (los
modelos de hardware que puedes asignarle a un activo).

## Activos

Cada fila es un equipo de TI, con su tipo, estado, IP, hostname, número de
serie, fabricante/modelo y sistema operativo. Las pestañas sobre la lista
agrupan los tipos:

| Grupo | Tipos |
| --- | --- |
| Computadores | Estación de trabajo, notebook, servidor, tablet, dispositivo móvil |
| Red | Switch, router, firewall, punto de acceso Wi-Fi, otro dispositivo de red |
| Periféricos | Monitor, periférico (teclado, mouse, audífonos), docking station, impresora, escáner, proyector, teléfono IP, cámara IP |
| Infraestructura | Almacenamiento (NAS/SAN), UPS |

Un activo se puede vincular a los tickets que lo afectan (desde el propio
ticket, ver [Tickets](/es/guia/tickets#el-panel-de-propiedades)). Así queda un
historial de qué problemas tuvo cada equipo.

### Datos de inventario

Además de los datos técnicos, cada activo puede registrar:
- **N.º de inventario**: tu propio número, como *TI-00042*. Se puede buscar.
- **Asignado a**: la persona que lo usa, uno de tus
  [contactos](/es/guia/contactos-y-datos-personales). Su página lista los
  equipos que tiene.
- **Ubicación**: piso, oficina o rack.
- **Conectado a**: el equipo al que se conecta, como un monitor o dock a su
  computador, o un switch a su router. La página de un computador lista lo
  que tiene conectado, y **+ Agregar** registra un periférico nuevo ya
  conectado.
- **Compra**: proveedor (del [directorio](/es/guia/directorio)), fecha,
  costo y moneda, y fin de la garantía. Una garantía vencida se muestra en
  rojo.
- **Notas**.

Los monitores, periféricos y docks no muestran los campos de red ni de
sistema operativo.

### Cómo llega un activo al inventario

- **Manual** — creado a mano desde **Nuevo Activo**.
- **Descubrimiento agentless** — escaneando un rango de red (TCP +
  SNMP) desde la propia pantalla de Activos. Encuentra lo que responde en
  la red, sin instalar nada en el equipo destino — con las limitaciones
  lógicas de esa técnica: si un equipo tiene el firewall cerrado o SNMP
  desactivado, no aparece.
- **Agente** — ver [Dispositivos](#dispositivos) abajo. Trae más detalle
  que el descubrimiento agentless porque corre *dentro* del equipo, no
  desde afuera.

El escaneo de red reconoce switches, routers, firewalls, puntos de acceso,
almacenamiento, UPS, impresoras, teléfonos IP y cámaras por lo que cada
equipo informa por SNMP. El agente clasifica los notebooks y tablets como
tales. También registra los monitores que ve en un computador, por número de
serie, como activos de tipo Monitor conectados a él. Si un monitor se cambia
a otro computador, lo sigue; nadie tiene que tipear números de serie.

## Dispositivos

**Dispositivos** es donde generas el comando de instalación del
[agente de Seredina](https://github.com/Haphior/seredina-agent). Es un solo
ejecutable para Windows, macOS y Linux (x86-64 y ARM64), y corre como
servicio. Cada hora reporta:

- Inventario de hardware y software, y la versión del sistema operativo.
- Si el disco está cifrado.
- El estado del antivirus.
- Los equipos que ve en su red local.

Para agregar un equipo:

1. Haz clic en **Generar comando de inscripción**.
2. Elige el sistema operativo del equipo.
3. Ejecuta el comando ahí como administrador. Vale 15 minutos y funciona una sola vez.

| Sistema | Dónde ejecutarlo |
|---|---|
| Windows | PowerShell abierto como administrador |
| macOS / Linux | Una terminal (usa `sudo`) |
| Ya descargado | La carpeta del agente, para un equipo sin acceso a internet |

El comando descarga el agente, verifica su SHA-256, inscribe el equipo y
deja el servicio corriendo. Si tu servidor usa un certificado privado, el
comando además lleva su CA. El agente confía solo en esa CA y nunca
desactiva la verificación del certificado.

Si tus equipos no llegan a GitHub, copia los archivos de una versión
(`install.sh`, `install.ps1`, los archivos comprimidos y `SHA256SUMS`) a un
servidor web interno. Pon la dirección de esa carpeta en
`AGENT_DOWNLOAD_URL`, en el `.env`. Los comandos van a descargar de ahí.

`seredina-agent status` muestra si el equipo está inscrito y si el servicio
corre. `seredina-agent uninstall --purge` quita el agente. Para
actualizarlo, ejecuta `seredina-agent update` como administrador: no hace
falta token y el equipo conserva su registro. Ver
[Actualizar los agentes](/es/despliegue/actualizaciones-y-backups#actualizar-los-agentes).

### Qué reporta el agente

Cada hora el agente envía un inventario completo. En la página del activo
se ve en pestañas, y **Descargar JSON** lo guarda entero:

| Pestaña | Qué contiene |
|---|---|
| Resumen | Fabricante, modelo y número de serie; sistema operativo y compilación; CPU; memoria; último arranque; usuario con sesión; dominio; IPs. Avisos si hay un reinicio pendiente, el disco sin cifrar, ningún antivirus activo o actualizaciones de seguridad pendientes. |
| Hardware | BIOS/UEFI; cada módulo de memoria (ranura, tamaño, tipo, velocidad, serie); gráficos; monitores con su número de serie; baterías con su salud y ciclos; impresoras. |
| Almacenamiento | Discos físicos (SSD, HDD o NVMe, bus, serie, salud) y volúmenes (sistema de archivos, espacio libre, cifrado). |
| Red | Cada adaptador con su MAC, IPs, puerta de enlace, DNS, DHCP y velocidad. |
| Software | Cada programa instalado con su versión, fabricante y fecha de instalación, con buscador. |
| Seguridad | Cifrado del disco, firewall, Secure Boot, TPM, UAC/SELinux/Gatekeeper, antivirus y su estado, agentes de seguridad en ejecución (EDR), administradores locales. |
| Actualizaciones | Actualizaciones instaladas (KB de Windows, actualizaciones de macOS) y, en Linux, las pendientes. |
| Servicios, Puertos | Para servidores: el estado y el tipo de inicio de cada servicio, y qué escucha en cada puerto. |
| Roles y VMs | Roles de Windows Server y software de servidor reconocido (SQL Server, IIS, PostgreSQL, nginx, Docker...), y las VMs y contenedores que aloja el equipo (Hyper-V, Proxmox, libvirt, Docker). |

El fabricante, el modelo, el número de serie y el sistema operativo
también llenan los campos del activo, así que el buscador de **Activos**
encuentra un equipo por su número de serie.

### Servidores

El agente funciona igual en servidores: Windows Server 2012 o posterior,
y cualquier Linux con systemd (Ubuntu, Debian, RHEL, Rocky, Alma,
SUSE...). Un servidor queda como **Servidor** por sí solo:

- **Windows:** las ediciones Server.
- **Linux:** los equipos sin sesión gráfica.

Si cambias el tipo de un activo a mano, tu elección se mantiene. Solo
vuelve a cambiar si el rol del equipo cambia de verdad (por ejemplo, si se
reinstala como estación de trabajo).

Para ver el inventario sin enviarlo (de un equipo que estás revisando, o
para adjuntarlo a un ticket), ejecuta `seredina-agent inventory` como
administrador.

::: warning Solo inventario, por diseño permanente
El agente **nunca ejecuta nada remotamente** — ni scripts, ni despliegue
de software. No es una limitación temporal de esta versión: ejecución
remota necesita un canal de entrega firmado y auditado que este proyecto
de código abierto sin financiamiento no puede mantener con
responsabilidad. Las versiones del agente tampoco están firmadas todavía:
SmartScreen o Gatekeeper pueden advertir si abres el ejecutable a mano,
pero los comandos de instalación no se ven afectados.
Ver el [tour del MVP](https://github.com/Haphior/helpdesk-seredina) para
el razonamiento completo.
:::

Cada dispositivo enrolado aparece también en **Activos**, marcado con la
etiqueta "AGENT" como fuente de descubrimiento — es el mismo inventario,
solo con una columna extra indicando de dónde salió el dato. Revocar un
dispositivo desde esta pantalla corta sus futuros reportes sin borrar el
historial ya guardado.

## Contratos, garantías y licencias

**CMDB → Contratos** registra contratos de soporte, garantías, licencias de
software, arriendos y suscripciones. Cada uno tiene:
- el proveedor, elegido desde el [directorio](/es/guia/directorio) junto con
  la persona a la que llamar ahí, o escrito a mano;
- el número de contrato u orden;
- fechas de inicio y término;
- el costo (pago único, mensual o anual, en cualquier moneda);
- los puestos, para licencias;
- los activos que cubre.

La página de cada activo muestra los contratos que lo cubren.

### Pagos y recordatorios

Para recibir recordatorios de los pagos de un contrato, completa su sección
**Pagos**:
- la **frecuencia**: mensual, bimestral, trimestral, semestral, anual o
  pago único;
- el **próximo vencimiento**;
- el **monto**, si no es el costo del contrato;
- **cuántos días antes** avisar (5 por defecto);
- **a qué correos** enviar los recordatorios, como finanzas o TI.

Seredina les envía un correo a esas direcciones cuando un pago entra en ese
plazo. Si el vencimiento pasa sin un pago registrado, les escribe una vez
más. Cada recordatorio sale en el idioma y con el diseño de tu empresa,
configurados en [Correos al cliente](/es/guia/canales#correos-a-tus-clientes).
Además, quienes tienen un rol que gestiona activos reciben la notificación
*Pago de contrato por vencer*, en la aplicación y por correo si la
activaron.

Cuando hagas un pago, haz clic en **Registrar pago**. Ingresa la fecha, el
monto y el número de factura o transferencia. El contrato pasa al
siguiente vencimiento y conserva el día del mes: un contrato que se paga
el 31 vence el 28 de febrero y luego el 31 de marzo. Cada contrato guarda
su historial de pagos, y un registro equivocado se puede deshacer.

El encabezado de la página cuenta los pagos por vencer y los vencidos. Los
filtros *Pagos por vencer* y *Pagos vencidos* los listan.

Cada contrato indica si está vigente, por vencer o vencido. El encabezado
de la página suma lo que está por vencer, lo vencido y el costo recurrente
anual por moneda. **Avisar días antes** (30 por defecto) controla el aviso
de renovación: cuando un contrato entra en ese plazo, todas las personas
cuyo rol puede gestionar activos reciben una notificación *Contrato por
vencer*, en la aplicación y por correo si lo activaron en sus preferencias
de notificación. Hay un aviso por fecha de término; cambiar la fecha (una
renovación) lo vuelve a activar.

No pongas claves de licencia en estos campos: los ve cualquiera que pueda
ver los activos y se incluyen en las exportaciones de datos.

## Catálogo de Equipos

Un catálogo de fabricantes y modelos de hardware (por ejemplo, "Dell" →
"Latitude 5540") — separado de los activos individuales. Asignarle un
modelo del catálogo a un activo precarga su tipo por defecto, pero el
activo mantiene su propio campo de tipo editable independiente: el
catálogo sugiere, no fuerza.
