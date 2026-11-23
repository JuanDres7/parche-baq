# Parche

Parche es un prototipo académico de viajes compartidos entre estudiantes de Barranquilla. Desde una sola cuenta puedes publicar una ruta y reservar un cupo en la de otro estudiante.

## Demo pública

La demostración para el docente está disponible en **https://juanpres7.github.io/parche-baq/** (rama `gh-pages`). Abre el enlace, pulsa **Pasajera** o **Conductor** y sigue el flujo de la sección «Presentar el flujo». No necesitas instalar nada.

GitHub Pages solo sirve archivos estáticos: no puede ejecutar el servidor Node ni la base SQLite. Por eso la compilación pública incluye `src/client/demo-api.ts`, que reproduce los mismos endpoint (`/api/session`, `/api/trips`, reservas, pagos, calificaciones, etc.) dentro del navegador y guarda el estado en `localStorage`. Las cuentas y rutas de ejemplo son las mismas del servidor; la contraseña de las cuentas de demostración es `Parche123`. Los cambios de la demo son locales al navegador y se reinician al borrar los datos del sitio.

Para regenerar y publicar el sitio:

```powershell
npm run build:static
# copia el contenido de dist/ a la rama gh-pages y súbela
```

El producto con servidor real sigue disponible en el equipo con `npm start`. Los tres estudios (mercado, técnico y económico) se entregan como documentos independientes y no se publican en el sitio.

## Ejecutar en el equipo

Ejecuta este comando desde la carpeta del proyecto con Node.js 24 o superior.

```powershell
npm start
```

Abre [Parche en localhost](http://localhost:3000/) en tu navegador. El comando prepara la interfaz y arranca el servidor. El proyecto usa las bibliotecas integradas de Node.js y arranca sin descargar paquetes. Mantén abierta la terminal mientras usas la aplicación.

Las cuentas, rutas y reservas se guardan en `data/parche.sqlite`. Al abrir el proyecto por primera vez, Parche carga rutas y cuentas ficticias para la presentación.

## Presentar el flujo

1. En la pantalla inicial selecciona **Crear cuenta**, registra un perfil de prueba y modifica tus datos desde **Perfil**. En **Mi perfil** también puedes cambiar la contraseña y cerrar sesión.
2. En **Explorar**, escribe un origen, un destino o ambos. Prueba **Buenavista** y **Uninorte**. La lista sugiere rutas publicadas con cupo y señala las alternativas a menos de 1,5 km en línea recta de cada punto buscado. Abre un viaje para ver el punto de encuentro y el aporte.
3. En **Perfil**, cambia a conductor. En **Mis rutas**, selecciona **Crear ruta**. Elige un origen y un destino, fija la salida y los cupos, y agrega el costo total. Busca la publicación en **Mis rutas → Próximas**.
4. Abre la misma dirección en una ventana privada y usa **Pasajera** en la pantalla de acceso. Busca tu ruta, reserva y pulsa **Simular pago**. Verás el comprobante con su referencia. También puedes cerrar la pasarela y pagar después desde **Mis viajes → Mis reservas**. En los viajes gratuitos basta con reservar.
5. Vuelve al panel del conductor y abre **Ver detalles** para consultar quién reservó. El mapa y el historial muestran las rutas de tu cuenta. Puedes editar la ruta y cancelar la publicación. Desde la cuenta de pasajera también puedes liberar el cupo.

El botón **Conductor** de la pantalla de acceso abre el panel con rutas de ejemplo. El modo se recuerda en el navegador y puedes cambiarlo en **Perfil**. El historial se organiza por hora de salida. Las cuentas de demostración tienen un perfil fijo. Crea una cuenta propia para mostrar la edición de datos.

## Alcance

- El aporte estimado se divide entre el conductor y los pasajeros. El comprobante conserva el importe confirmado aunque cambie la ocupación. Los pagos usan saldo ficticio. Cancelar la reserva libera el cupo y anula su pago.
- El mapa está incluido en el proyecto. Ofrece puntos de encuentro predefinidos y trazados orientativos. Las calles, parques y cuerpos de agua provienen de [© OpenStreetMap y sus colaboradores](https://www.openstreetmap.org/copyright). El extracto `public/barranquilla.json` se distribuye bajo [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
- Puedes instalar la PWA desde el menú de un navegador compatible. La pantalla de acceso queda disponible tras la primera carga. La aplicación comprueba la sesión con el servidor local antes de mostrar los viajes. Mantén el servidor local abierto para consultar rutas, ingresar y guardar cambios.
- `npm test` ejecuta la prueba de cuentas, permisos, publicación, edición, reserva simultánea del último cupo y cancelaciones con una base temporal en memoria.
