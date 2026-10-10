# Journal Trading

Checklist y journal de trading que corre 100% en el navegador. Los datos se
guardan en `localStorage`, sin backend ni build.

## Cómo usarlo

Abrí `index.html` en el navegador (pantalla de inicio → elegir plan → crear
cuenta → journal), o servilo localmente:

```bash
python3 -m http.server 8000
# http://localhost:8000
```

> Los datos viven en el navegador y en el origen desde donde abras la app
> (`file://` y `http://localhost:8000` tienen almacenamientos distintos).
> Usá **Ajustes → Copia de seguridad** para exportar/importar un JSON.

## Estructura

```
index.html       Pantalla de inicio: funciones y planes (prueba gratis 7 días / Pro)
auth.html        Login y registro, con elección de plan
terminos.html    Términos y condiciones (en preparación)
privacidad.html  Política de privacidad (en preparación)
app.html         El journal (pestañas Trade, Stats, Calendario, Historial, Ajustes)
css/styles.css   Tokens de color (claro/oscuro) y estilos de la app
css/site.css     Estilos de inicio y login
js/icons.js      Íconos de línea en SVG (basados en Lucide, licencia ISC)
js/theme.js      Modo claro/oscuro (oscuro por defecto, la elección se guarda)
js/auth.js       Usuarios, sesión y planes (simulados en localStorage)
js/session.js    Header del usuario, plan, paywall al vencer la prueba y logout
js/storage.js    Persistencia del journal por usuario: adapter de localStorage,
                 versión de esquema, migraciones, export/import
js/i18n.js       Idiomas: t('texto') traduce, translateDom() traduce el HTML fijo
js/lang-en.js    Diccionario al inglés (clave = texto original en español)
js/time.js       Horarios: todo se calcula en hora de Nueva York (día de trading,
                 sesiones, mapa de calor); las horas se muestran en NY o en la local
js/app.js        Lógica y renderizado del journal
js/importer.js   Importador de trades desde CSV de cualquier plataforma (mapeo
                 manual de columnas); los importados quedan "por completar"
js/accounts.js   Cuentas (personal, challenge, fondeada): reglas de prop firm por
                 cuenta, selector de cuenta, progreso en Inicio y editor en Ajustes
js/onboarding.js Configuración guiada al entrar por primera vez (cuentas nuevas)
js/analytics.js  Curvas, agrupaciones y patrones automáticos sobre el historial
js/charts.js     Gráfico de líneas en SVG (sin librerías)
js/achievements.js Meta mensual de disciplina y logros
js/dashboard.js  Pestaña Inicio
js/analysis.js   Curva, patrones, mapa de calor y desglose en Estadísticas
js/review.js     Revisión semanal guiada
js/calendar.js   Calendario mensual/anual y panel con el detalle de cada día
img/og-image.png Imagen para compartir el link en redes y WhatsApp
```

### Cuentas simuladas

Todavía no hay backend: los usuarios, la sesión y el plan viven en el
`localStorage` del navegador (`jt_users`, `jt_session`). Cada usuario tiene su
propio journal (`tradingChecklistState:<userId>`). La prueba gratis dura 7 días;
al vencer aparece un paywall. Pasar a Pro no cobra nada todavía.

## Camino a SaaS

`app.js` solo lee y escribe a través de `JournalStore` (`js/storage.js`). Para
pasar a un backend:

1. Escribir un adapter con la misma interfaz (`load`, `save`, `clear`) que
   llame a una API, y asignarlo a `JournalStore.adapter`.
2. Mover las imágenes de los trades fuera del JSON (hoy van en base64 y
   `localStorage` tiene ~5 MB de límite) a un storage de archivos.
3. Reemplazar `js/auth.js` por autenticación real y una pasarela de pagos
   para Pro; el backup JSON sirve para migrar los datos que ya
   tengan los usuarios en su navegador.

Si cambia la forma de los datos, subir `SCHEMA_VERSION` y agregar la migración
correspondiente en `MIGRATIONS`.

## Idiomas

El español es el texto original y queda escrito en el código y en el HTML.
Para mostrar algo traducible desde JS se usa `t('Texto en español')` (con
variables: `t('Te quedan {n} días.', {n})`; con plural:
`tp(n, '{n} trade', '{n} trades')`). El HTML fijo se traduce solo al cargar.
Cada frase nueva necesita su traducción en `js/lang-en.js`; si falta, se ve en
español y queda anotada en `I18N_MISSING` (consola del navegador).

## Publicar cambios

Las páginas cargan CSS y JS con un número de versión (`styles.css?v=12`). Al
publicar cambios en `css/` o `js/`, subí ese número en todos los `.html` para que
los navegadores no mezclen una página nueva con archivos viejos guardados:

```bash
sed -i 's/?v=[0-9]*"/?v=13"/g' *.html
```
