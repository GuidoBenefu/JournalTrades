# Journal de trades

Checklist y journal de trading que corre 100% en el navegador. Los datos se
guardan en `localStorage`, sin backend ni build.

## Cómo usarlo

Abrí `index.html` en el navegador, o servilo localmente:

```bash
python3 -m http.server 8000
# http://localhost:8000
```

> Los datos viven en el navegador y en el origen desde donde abras la app
> (`file://` y `http://localhost:8000` tienen almacenamientos distintos).
> Usá **Ajustes → Copia de seguridad** para exportar/importar un JSON.

## Estructura

```
index.html       Markup de la app (pestañas Trade, Stats, Calendario, Historial, Ajustes)
css/styles.css   Estilos (claro/oscuro)
js/storage.js    Capa de persistencia: adapter de localStorage, versión de esquema,
                 migraciones, export/import
js/app.js        Lógica y renderizado
```

## Camino a SaaS

`app.js` solo lee y escribe a través de `JournalStore` (`js/storage.js`). Para
pasar a un backend:

1. Escribir un adapter con la misma interfaz (`load`, `save`, `clear`) que
   llame a una API, y asignarlo a `JournalStore.adapter`.
2. Mover las imágenes de los trades fuera del JSON (hoy van en base64 y
   `localStorage` tiene ~5 MB de límite) a un storage de archivos.
3. Agregar autenticación; el backup JSON sirve para migrar los datos que ya
   tengan los usuarios en su navegador.

Si cambia la forma de los datos, subir `SCHEMA_VERSION` y agregar la migración
correspondiente en `MIGRATIONS`.
