# Tickets

## La cola de tickets

**Tickets** en la barra lateral es la pantalla que más va a usar un
agente. Tiene cinco pestañas por categoría de estado (Todos, Abiertos,
Pendientes, Resueltos, Cerrados), un buscador de texto libre, y filtros
por responsable (incluyendo un atajo "Asignados a mí") y por prioridad.

### Vistas guardadas

Cualquier combinación de pestaña + filtros se puede guardar con
**+ Guardar esta vista** — aparece como una pastilla arriba de la tabla,
en la misma barra que los filtros, y se puede quitar con la × sin borrar
los tickets que representa.

### Selección y acciones en lote

Con el permiso de escritura sobre tickets, cada fila tiene un checkbox.
Seleccionando varios aparece una barra con tres acciones: asignar,
cambiar estado, o cambiar prioridad — a todos los seleccionados a la vez.
Es una capa de UI sobre el mismo endpoint de actualización individual, no
una ruta de backend separada.

### Crear un ticket manualmente

**Nuevo ticket** abre un modal con dos modos:

- **Ticket en blanco** — para un caso que llegó por teléfono o en
  persona: asunto, descripción, datos del solicitante, prioridad.
- **Desde catálogo** — si tu tenant tiene ítems configurados en el
  [Catálogo de servicios](/es/guia/catalogo-de-servicios), elegís uno y el
  formulario se arma solo con sus campos personalizados asociados.

Si no hay ítems de catálogo configurados, el modal arranca directo en modo
"en blanco".

## El detalle de un ticket

### Encabezado

Estado, prioridad y canal como badges; un indicador si la primera
respuesta o la resolución están vencidas según el SLA aplicable (ver
[SLA y escalamiento](/es/guia/sla-y-escalamiento)); y, si hay más de un
agente mirando el mismo ticket en simultáneo, un aviso "También viendo:"
con los nombres — para evitar que dos personas respondan lo mismo sin
saberlo.

### Acciones sobre el ticket

- **Fusionar en…** — mueve todos los mensajes de este ticket a otro y
  cierra este con una nota apuntando al destino. Útil cuando el mismo
  problema generó dos tickets separados.
- **Ejecutar macro…** (si hay macros configuradas) — aplica de una vez un
  conjunto de cambios predefinidos (cambiar estado, asignar, agregar una
  respuesta) desde **Configuración → Macros**.
- **Resumir** / **Dejar que la IA lo intente** — ver
  [Copiloto de IA](/es/guia/copiloto-de-ia).

### Mensajes y respuestas

El hilo muestra cada mensaje con su autor y hora. Una nota marcada como
**Nota interna** tiene fondo ámbar y nunca es visible para el contacto —
es para coordinación entre agentes. Cualquier respuesta puede llevar
archivos adjuntos.

### El panel de propiedades

A la derecha: estado, prioridad, equipo, responsable, y el problema
vinculado (si lo hay) — todos editables en línea, sin abrir un formulario
aparte. Debajo, si el ticket tiene una fecha límite de primera respuesta
o de resolución, se muestra cuándo se cumplió o cuándo vence.

Si tu tenant tiene [campos personalizados](/es/guia/administracion#campos-personalizados)
configurados, aparecen en el mismo panel — el tipo de campo (texto,
número, sí/no, fecha, o una lista de opciones) determina el control que
se muestra.

Más abajo, los datos de contacto de quien abrió el ticket, y los activos
de CMDB vinculados — con la opción de vincular uno nuevo desde un
desplegable, y ver qué servicios reales quedan afectados si ese activo
tiene servicios asociados.

## Notificaciones

La campana arriba en la barra lateral muestra lo que te pasó. Cada evento
también puede llegar por correo, lo que necesita un
[canal de correo](/es/guia/canales#correo-electronico) conectado.

| Evento | Quién lo recibe |
|---|---|
| Se me asigna un ticket | El nuevo responsable (no cuando te lo asignas tú) |
| Un contacto responde | El responsable |
| Llega un ticket a mi equipo | Cada miembro del equipo, si el ticket no tiene responsable |
| Un cliente reabre un ticket | El responsable, o el equipo si no hay responsable |
| Alguien me menciona | Las personas @mencionadas en una nota interna |
| SLA por vencer | El responsable, o el equipo, al usarse el 80 % del plazo |
| SLA vencido | El responsable, o el equipo, cuando pasa el plazo |
| Un contrato está por vencer | Quienes pueden gestionar activos |

Un cliente que vuelve a escribir en un ticket **resuelto o cerrado**, por
correo o desde el portal, lo reabre.

Para mencionar a alguien, marca **Nota interna** y escribe `@`: elige a un
colega de la lista. Las menciones solo funcionan en notas internas, así el
cliente nunca las ve.

**Configuración de notificaciones** (desde la campana) define, para cada
evento, si lo recibes en la aplicación y por correo. Los administradores
también definen ahí los **valores por defecto para toda la organización**:
lo que recibe cada persona mientras no elija por su cuenta. Lo que elige
cada persona siempre manda, y **Usar el valor de la organización** vuelve a
él.
