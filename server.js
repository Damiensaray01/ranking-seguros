const express = require('express');
const axios = require('axios');
const csv = require('csv-parser');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

const URL_LLAMADAS = 'https://docs.google.com/spreadsheets/d/1SRj764C3n8bk7zZH8x_HPTK-Y4AM828vKNX4TIhP3F0/export?format=csv&gid=1563288647';
const URL_VENTAS = 'https://docs.google.com/spreadsheets/d/1PcmRLaA3jh0JoZWbiZtAtw_7wLj4IYFyxDHoCoTzZQA/export?format=csv&gid=1205148090';

const asesoresLista = [
  "Berenice Troconiz", "Alejandra Mujica", "Roikel Suniaga", "Kariosqui Gomez", 
  "Duvan Moreno", "Carolina Rojas", "Carlos Argort", "Gabriela Barrios", 
  "Yanfran Sanchez", "Hecmy Perez", "Santiago Robelo", "Corina Arce", "Evelyn La Rosa"
];

async function leerCSVdesdeURL(url) {
  const response = await axios.get(url, { responseType: 'stream' });
  const resultados = [];
  return new Promise((resolve, reject) => {
    response.data
      .pipe(csv())
      .on('data', (data) => resultados.push(data))
      .on('end', () => resolve(resultados))
      .on('error', (error) => reject(error));
  });
}

app.get('/api/ranking', async (req, res) => {
  try {
    const [datosLlamadas, datosVentas] = await Promise.all([
      leerCSVdesdeURL(URL_LLAMADAS),
      leerCSVdesdeURL(URL_VENTAS)
    ]);

    const metricas = {};
    asesoresLista.forEach(nombre => {
      metricas[nombre] = {
        nombre,
        llamadas: 0,
        contactosEfectivos: 0,
        ventas: 0,
        montoFacturado: 0
      };
    });

    datosLlamadas.forEach(row => {
      const nombre = row['Asesor']?.trim();
      if (metricas[nombre]) {
        metricas[nombre].llamadas += Number(row['Llamadas'] || 0);
        metricas[nombre].contactosEfectivos += Number(row['Contactos'] || 0);
      }
    });

    datosVentas.forEach(row => {
      const nombre = row['Asesor']?.trim();
      if (metricas[nombre]) {
        metricas[nombre].ventas += Number(row['Ventas'] || 1);
        metricas[nombre].montoFacturado += Number(row['Monto'] || 0);
      }
    });

    const rankingFinal = Object.values(metricas).map(asesor => {
      const puntaje = (asesor.ventas * 10) + (asesor.contactosEfectivos * 3) + (asesor.llamadas * 0.5);
      return { ...asesor, puntaje: Math.round(puntaje * 100) / 100 };
    });

    rankingFinal.sort((a, b) => b.puntaje - a.puntaje);
    res.json(rankingFinal);
  } catch (error) {
    console.error("Error al procesar las hojas:", error);
    res.status(500).json({ error: 'No se pudieron procesar las hojas de cálculo' });
  }
});

// Esto permite que corra local con "npm start" y también en Vercel
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Servidor local en http://localhost:${PORT}`);
  });
}

module.exports = app;