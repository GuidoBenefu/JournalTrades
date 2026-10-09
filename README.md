# Journal de trades

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
app.html         El journal (pestañas Trade, Stats, Calendario, Historial, Ajustes)
css/styles.css   Tokens de color (claro/oscuro) y estilos de la app
css/site.css     Estilos de inicio y login
js/theme.js      Modo claro/oscuro (oscuro por defecto, la elección se guarda)
js/auth.js       Usuarios, sesión y planes (simulados en localStorage)
js/session.js    Header del usuario, plan, paywall al vencer la prueba y logout
js/storage.js    Persistencia del journal por usuario: adapter de localStorage,
                 versión de esquema, migraciones, export/import
js/app.js        Lógica y renderizado del journal
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
