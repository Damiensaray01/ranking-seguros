const express = require('express');
const axios = require('axios');
const csv = require('csv-parser');
const cors = require('cors');
const { Readable } = require('stream');

const app = express();
app.use(cors());

const URL_LLAMADAS = 'https://docs.google.com/spreadsheets/d/1SRj764C3n8bk7zZH8x_HPTK-Y4AM828vKNX4TIhP3F0/export?format=csv&gid=1563288647';
const URL_VENTAS = 'https://docs.google.com/spreadsheets/d/1PcmRLaA3jh0JoZWbiZtAtw_7wLj4IYFyxDHoCoTzZQA/export?format=csv&gid=1205148090';

const asesoresLista = [
  "Roikel Suniaga", "Kariosqui Gomez", "Carolina Rojas", "Danielis Villegas",
  "Kismar Hernandez", "Cindy Suarez", "Krisbel Ramos", "Oriana Aponte", 
  "Keisy Plaza", "Yerlis Vasquez", "Nallely Regifo", "Omar Mesia"
];

const mesesNombres = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

async function leerCSVdesdeURL(url) {
  const response = await axios.get(url, {
    responseType: 'text',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    },
    timeout: 15000
  });

  const resultados = [];
  return new Promise((resolve, reject) => {
    Readable.from([response.data])
      .pipe(csv())
      .on('data', (data) => resultados.push(data))
      .on('end', () => resolve(resultados))
      .on('error', (error) => reject(error));
  });
}

function extraerMesDeFecha(texto) {
  if (!texto) return '';
  const textoLower = String(texto).trim().toLowerCase();

  for (const mes of mesesNombres) {
    if (textoLower.includes(mes)) return mes;
  }

  let mesNum = null;
  const match = textoLower.match(/[\/\-](\d{1,2})[\/\-]/) || textoLower.match(/^(\d{4})[\/\-](\d{1,2})[\/\-]/) || textoLower.match(/^(\d{1,2})[\/\-](\d{1,2})/);
  
  if (match) {
    mesNum = parseInt(match[1] || match[2], 10);
  } else if (textoLower.includes('/') || textoLower.includes('-')) {
    const partes = textoLower.split(/[\/\-]/);
    if (partes.length >= 2) mesNum = parseInt(partes[1], 10);
  }

  if (mesNum && mesNum >= 1 && mesNum <= 12) {
    return mesesNombres[mesNum - 1];
  }

  return '';
}

app.get('/api/ranking', async (req, res) => {
  try {
    const mesActualCalculado = mesesNombres[new Date().getMonth()];
    const mesFiltro = (req.query.mes || mesActualCalculado || 'noviembre').toLowerCase().trim();
    const mesPrefijo = mesFiltro.slice(0, 3);

    const [datosLlamadas, datosVentas] = await Promise.all([
      leerCSVdesdeURL(URL_LLAMADAS),
      leerCSVdesdeURL(URL_VENTAS)
    ]);

    const metricas = {};
    asesoresLista.forEach(nombre => {
      metricas[nombre] = {
        nombre: nombre,
        llamadas: 0,
        contactosEfectivos: 0,
        ventasTotales: 0,
        ventasCobradas: 0
      };
    });

    const buscarAsesorCoincidente = (nombreCrudo) => {
      if (!nombreCrudo) return null;
      const limpio = String(nombreCrudo).trim().toLowerCase();
      for (const asesor of asesoresLista) {
        if (asesor.toLowerCase() === limpio || limpio.includes(asesor.toLowerCase())) {
          return asesor;
        }
      }
      return null;
    };

    // 1. Procesar llamadas
    if (Array.isArray(datosLlamadas)) {
      datosLlamadas.forEach(row => {
        if (!row) return;
        const keys = Object.keys(row);
        
        const colMesExplicit = (row['Mes'] || row['mes'] || '').toString().trim().toLowerCase();
        const fechaGestion = row['Fecha'] || row['Marca temporal'] || row['Timestamp'] || (keys[0] ? row[keys[0]] : '');
        const mesDetectado = colMesExplicit || extraerMesDeFecha(fechaGestion);

        if (mesDetectado !== mesFiltro && !mesDetectado.includes(mesPrefijo)) return;

        const nombreCrudo = row['full_name'] || row['Full Name'] || row['Asesor'] || row['Nombre'] || '';
        const asesorValido = buscarAsesorCoincidente(nombreCrudo);

        if (asesorValido && metricas[asesorValido]) {
          metricas[asesorValido].llamadas += Number(row['Registro Unico'] || row['Registro Único'] || 1);
          const tipoContacto = (row['Tipo de Contacto'] || row['Contacto'] || '').toString().trim().toLowerCase();
          if (tipoContacto === 'efectivo') {
            metricas[asesorValido].contactosEfectivos += 1;
          }
        }
      });
    }

    // 2. Procesar ventas
    let totalVentasGeneradasGlobal = 0;
    let totalVentasCobradasGlobal = 0;

    if (Array.isArray(datosVentas)) {
      datosVentas.forEach(row => {
        if (!row) return;

        let valorStatusCobro = '';
        let valorParentesco = '';
        const valoresFila = Object.values(row).map(v => String(v || '').trim().toLowerCase());
        const textoFilaCompleta = valoresFila.join(' ');

        for (const [key, value] of Object.entries(row)) {
          const kClean = key.toLowerCase().trim();
          const valStr = String(value || '').trim().toLowerCase();
          
          if (kClean.includes('status de cobro') || kClean.includes('estatus de cobro')) {
            if (valStr) valorStatusCobro = valStr;
          }
          if (kClean.includes('parentesco')) {
            valorParentesco = valStr;
          }
        }

        const colMesVentas = (row['Mes'] || row['mes'] || '').toString().trim().toLowerCase();
        const marcaTemporal = row['Marca temporal'] || row['Fecha'] || (Object.keys(row)[0] ? row[Object.keys(row)[0]] : '');
        const mesDetectadoVentas = colMesVentas || extraerMesDeFecha(marcaTemporal);

        // Validar que pertenezca al mes (o que el estatus de cobro corresponda a noviembre)
        const esMesNoviembre = mesDetectadoVentas === mesFiltro || mesDetectadoVentas.includes(mesPrefijo) || valorStatusCobro.includes('noviembre');
        if (!esMesNoviembre) return;

        // Filtro de Parentesco (titular masculino / femenino)
        if (!valorParentesco.includes('titular')) return;

        // Exclusión de renovaciones
        if (/\breno\b|renov/i.test(textoFilaCompleta)) return;

        const keysVentas = Object.keys(row);
        const nombreCrudo = row['Asesor'] || row['Nombre del Asesor'] || (keysVentas[22] ? row[keysVentas[22]] : '');
        const asesorValido = buscarAsesorCoincidente(nombreCrudo);

        if (asesorValido && metricas[asesorValido]) {
          metricas[asesorValido].ventasTotales += 1;
          totalVentasGeneradasGlobal += 1;

          // Contar como cobrada si el estatus de cobro indica claramente noviembre
          const estaCobrada = valorStatusCobro.length > 0 && 
                              (valorStatusCobro.includes('noviembre') || valorStatusCobro.includes('nov')) && 
                              !valorStatusCobro.includes('pendiente') && 
                              !valorStatusCobro.includes('no');

          if (estaCobrada) {
            metricas[asesorValido].ventasCobradas += 1;
            totalVentasCobradasGlobal += 1;
          }
        }
      });
    }

    // 3. Generar ranking ordenado por Ventas Cobradas
    const rankingFinal = Object.values(metricas).sort((a, b) => {
      if (b.ventasCobradas !== a.ventasCobradas) {
        return b.ventasCobradas - a.ventasCobradas;
      }
      if (b.ventasTotales !== a.ventasTotales) {
        return b.ventasTotales - a.ventasTotales;
      }
      return b.llamadas - a.llamadas;
    });

    res.json({
      meta: 400,
      mesActual: mesFiltro,
      totalVentasGeneradas: totalVentasGeneradasGlobal,
      totalVentasCobradas: totalVentasCobradasGlobal,
      ranking: rankingFinal
    });

  } catch (error) {
    console.error("Error backend:", error);
    res.status(500).json({ 
      error: 'No se pudieron procesar las hojas de cálculo',
      detalle: error.message 
    });
  }
});

if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Servidor local ejecutándose en http://localhost:${PORT}`));
}

module.exports = app;