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
  "Kismar Hernandez", "Luisiana Nacero", "Angi Torres", "Cindy Suarez",
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
    const mesFiltro = (req.query.mes || mesActualCalculado || 'octubre').toLowerCase().trim();

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

    // 1. Procesar llamadas
    if (Array.isArray(datosLlamadas)) {
      datosLlamadas.forEach(row => {
        if (!row) return;
        const keys = Object.keys(row);
        
        const colMesExplicit = (row['Mes'] || row['mes'] || '').toString().trim().toLowerCase();
        const fechaGestion = row['Fecha'] || row['Marca temporal'] || row['Timestamp'] || (keys[0] ? row[keys[0]] : '');
        const mesDetectado = colMesExplicit || extraerMesDeFecha(fechaGestion);

        if (mesDetectado !== mesFiltro) return;

        const nombre = (row['full_name'] || row['Full Name'] || row['Asesor'] || row['Nombre'] || '')?.trim();
        if (metricas[nombre]) {
          metricas[nombre].llamadas += Number(row['Registro Unico'] || row['Registro Único'] || 1);
          const tipoContacto = (row['Tipo de Contacto'] || row['Contacto'] || '').toString().trim().toLowerCase();
          if (tipoContacto === 'efectivo') {
            metricas[nombre].contactosEfectivos += 1;
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
        const keysVentas = Object.keys(row);
        
        const colMesVentas = (row['Mes'] || row['mes'] || '').toString().trim().toLowerCase();
        const marcaTemporal = row['Marca temporal'] || row['Fecha'] || (keysVentas[0] ? row[keysVentas[0]] : '');
        const mesDetectadoVentas = colMesVentas || extraerMesDeFecha(marcaTemporal);

        if (mesDetectadoVentas !== mesFiltro) return;

        const parentesco = (row['Parentesco'] || '').toString().trim();
        if (parentesco !== 'Titular Masculino' && parentesco !== 'Titular Femenino') return;

        // Exclusión de renovaciones
        const filaTexto = JSON.stringify(row).toLowerCase();
        const esRenovacion = /\breno\b|renov/i.test(filaTexto);
        if (esRenovacion) return;

        const nombreAsesor = (row['Asesor'] || row['Nombre del Asesor'] || (keysVentas[22] ? row[keysVentas[22]] : ''))?.trim();

        if (metricas[nombreAsesor]) {
          metricas[nombreAsesor].ventasTotales += 1;
          totalVentasGeneradasGlobal += 1;

          // Columna AE ("status de cobro")
          let valorStatusCobro = '';
          for (let i = 0; i < keysVentas.length; i++) {
            const kClean = keysVentas[i].toLowerCase().trim();
            if (kClean === 'status de cobro' || kClean === 'estatus de cobro' || i === 30) {
              const val = String(row[keysVentas[i]] || '').trim().toLowerCase();
              if (val) valorStatusCobro = val;
            }
          }

          const estaCobrada = valorStatusCobro.includes(mesFiltro) && 
                              !valorStatusCobro.includes('pendiente') && 
                              !valorStatusCobro.includes('no');

          if (estaCobrada) {
            metricas[nombreAsesor].ventasCobradas += 1;
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