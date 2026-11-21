# Gestor de Pedidos

Piloto web para comparar ofertas, guardar borradores y preparar pedidos de WhatsApp por proveedor.

## Abrir en esta computadora

Abre `dist/index.html` con doble clic. También puedes servir la carpeta `dist` con `python -m http.server 8765 --bind 127.0.0.1 --directory dist` y abrir [el piloto](http://127.0.0.1:8765).

## Preparar un pedido

1. En **Proveedores**, agrega el nombre y los datos de contacto para pedidos. Usa el número de WhatsApp en formato internacional, por ejemplo `+56 9 1234 5678`.
2. En **Catálogos**, selecciona el proveedor y pulsa **Cargar catálogo**. Las ofertas quedan disponibles en **Comparar**. Puedes corregir cantidades, precios y disponibilidad con **Editar catálogo**. Para hojas con encabezados diferentes, puedes adaptar los datos a la plantilla Excel.
3. En **Comparar**, busca el producto y agrega la presentación elegida. Puedes asignar un nombre común con **Equivalencia** en cada oferta que quieras comparar.
4. Ajusta la cantidad de unidades en **Mi pedido** y pulsa **Guardar pedido** para retomarlo en **Pedidos**. El número incluye fecha, correlativo y proveedores, y puedes editarlo. En el bloque de cada proveedor, abre WhatsApp o prepara un correo, revisa el mensaje y envíalo cuando esté listo.

## Cuenta, sincronización y uso sin conexión

- En **Cuenta**, registra una cuenta o inicia sesión. Usa la misma cuenta en cada equipo de tu negocio. Supabase guarda un espacio privado por cuenta, con los precios vigentes, el precio anterior de cada oferta y los pedidos.
- Para trasladar los datos del piloto local, abre **Cuenta → Descargar respaldo** antes de iniciar sesión. En la app con tu cuenta abierta, importa el archivo y comprueba que se sincronice.
- Después de abrir la app por HTTPS y sincronizar por primera vez, puedes volver a abrirla en ese equipo sin internet. Puedes consultar los precios descargados, cargar CSV o TSV y guardar pedidos. El inicio de sesión, la sincronización, la descarga de los lectores de PDF, Excel e imágenes y el envío por WhatsApp o correo necesitan conexión.
- Cuando otro equipo haya sincronizado cambios mientras este estaba desconectado, la app conserva la copia local y solicita resolver el conflicto. Puedes descargar un respaldo local y luego abrir la copia en línea.

## Avisos en el celular

1. Abre la app desde su icono en la pantalla de inicio y entra en **Cuenta**.
2. Inicia sesión con la misma cuenta que usa el otro equipo del negocio.
3. Pulsa **Activar notificaciones**, acepta el permiso del celular y pulsa **Probar aviso**.

Cuando el otro equipo pulse **Ya lo envié** o confirme un pedido, recibirás un aviso después de que el cambio se sincronice. Tócalo para abrir el pedido. El celular que realizó el cambio no recibe su propio aviso. Con la app abierta también aparece una breve animación, respetando la preferencia de movimiento reducido.

Los avisos pueden llegar con la pantalla bloqueada y no necesitan que la sesión de acceso siga vigente. Cerrar sesión expresamente desactiva los avisos en ese equipo. El sonido y la visualización en la pantalla bloqueada dependen de los permisos, volumen y modo No molestar del celular. En iPhone, abre la app instalada en la pantalla de inicio.

### Servicio de notificaciones

El esquema de `supabase/push-schema.sql` instala una cola privada por dispositivo, un disparador de cambios del espacio y un reintento por minuto. La función `supabase/functions/order-push/index.ts` valida la sesión al registrar/desactivar dispositivos; el despachador valida una credencial propia del servidor. Las claves VAPID se generan una sola vez en el servidor y quedan en una tabla sin acceso para clientes. No hay claves privadas en los archivos publicados.

Los avisos pendientes se reintentan hasta ocho veces. Los registros que el servicio push identifica como vencidos se desactivan. El botón de prueba comprueba que el proveedor push acepte el aviso; la recepción y el sonido deben comprobarse en el celular.

### Verificación

Con Node.js: `npm ci` y `npm test`. Las pruebas cubren la persistencia del registro cuando vence la sesión, la revocación al cerrar sesión, el aviso del service worker y el envío cifrado sin depender de la sesión del receptor. `supabase/push-test.sql` prueba los eventos de base de datos y revierte todos los datos de prueba al terminar.

## Publicar una versión

Sirve `dist/` por HTTPS. El proyecto usa la URL y clave publicable de Supabase de `dist/cloud-config.js`. La migración de `supabase/migrations/` habilita un espacio por cuenta y limita el acceso a su propietario. Cambia la versión de la caché en `dist/offline.js` cuando actualices los recursos que se usan sin conexión.

Cuando el proveedor publica los dos precios por unidad de compra, se usan ambos. Si solo publica uno, el otro se calcula con IVA del 19 % y se redondea a pesos.
