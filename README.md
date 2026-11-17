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

## Despliegue

Sirve `dist/` por HTTPS. El proyecto usa la URL y clave publicable de Supabase de `dist/cloud-config.js`. La migración de `supabase/migrations/` habilita un espacio por cuenta y limita el acceso a su propietario. Cambia la versión de la caché en `dist/offline.js` cuando actualices los recursos que se usan sin conexión.

Cuando el proveedor publica los dos precios por unidad de compra, se usan ambos. Si solo publica uno, el otro se calcula con IVA del 19 % y se redondea a pesos.
