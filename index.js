const express = require('express'); //framework Express
const bodyParser = require('body-parser');
const fs = require('fs');
const axios = require('axios'); //Librería Axios
const { jsPDF } = require('jspdf'); //Librería JSPDF
require('jspdf-autotable'); // Plugin autotable
const fuentes = require('./fuentes.js'); // Importación en CommonJS

const app = express();
const port = process.env.PORT || 4000;

app.use(bodyParser.json());

//Muestra la página de incio de la aplicación Express
app.get("/", (req, res) => {
  res.send("La página de inicio");
});
//Método principal que permite crear toda la comunicación con
//la API de Monday.com  y los webhooks.
app.post("/", async (req, res) => {
  const payload = req.body;
  console.log(req.body);
  //Este if permite ver si tenemos control de nuestra aplicación para responder el desafío
  if (payload && payload.challenge) {
    // Verificación del desafío
    console.log('Received challenge:', payload.challenge);
    const challengeResponse = { challenge: payload.challenge };
    res.status(200).json(challengeResponse);
  } else if (payload && payload.event) {
    // Una vez corroborado el desafío corresponde el Procesamiento de eventos
    const { pulseId, pulseName, type, columnTitle, value, boardId, groupId } = payload.event;
    console.log(value.label.text);
    try {
      if (type === "update_column_value" && value.label.text === "COTIZAR") {
        //console.log(pulseId);
        //Paso 1: Obtenemos los datos de la OP.
        const datosCotizacion = await getCaracteristicasCotizacion(pulseId);
        console.log(datosCotizacion);
        //console.log(datosOP[0].name);
        const numeroCotizacion = datosCotizacion[0].name;
        const cotizacion = datosCotizacion[0].column_values;
        //const mesesFinanciamiento = cotizacion.find(item => item.id === 'reflejo2__1').display_value;
        //Paso 3: Mandamos a generar el docuemnto PDF con los datos necesarios
        const pdfBase64 = await obtenerDocumentoCotizacion(cotizacion, numeroCotizacion);
        // Asignar el nombre al PDF
        const nombreArchivo = numeroCotizacion;
        //Paso 4: Subir documento PDF a monday.com
        await subirArchivoAMonday(parseInt(pulseId), pdfBase64, nombreArchivo);

      }
      //Si ocurre un error la estructura de control lo atrapa y lo imprime en consola. 
    } catch (error) {
      console.error('Ocurrió un error:', error);
    }
    res.status(200).send('Event processed');
  } else {
    // Si no es un desafío ni un evento válido, regresa un error
    res.status(400).send('Invalid payload');
  }
});
//Este Método nos permite subir los documentos PDF a monday.com
async function subirArchivoAMonday(pulseId, pdfBase64, nombreArchivo) {
  const query = `
    mutation ($file: File!) {
      add_file_to_column(file: $file, item_id: ${pulseId}, column_id: "archivo__1") {
        id
      }
    }
  `;

  const formData = new FormData();
  formData.append('query', query);

  // Convierte la cadena base64 a Blob antes de adjuntarla a FormData
  const pdfBlob = new Blob([Buffer.from(pdfBase64.split(',')[1], 'base64')], { type: 'application/pdf' });
  formData.append('variables[file]', pdfBlob, nombreArchivo + '.pdf');
  try {
    const response = await axios.post('https://api.monday.com/v2/file', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
        'Authorization': 'eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjM4MDk5MjcyMiwiYWFpIjoxMSwidWlkIjo0MDY5NzEwMSwiaWFkIjoiMjAyNC0wNy0wNVQyMTowMjozMi4wMDBaIiwicGVyIjoibWU6d3JpdGUiLCJhY3RpZCI6MTA5Mjg0OTUsInJnbiI6InVzZTEifQ.55PVw2YfNZ7d7DUgqfEOl4vLHlh3MU5QGnwReMl-NpQ' //API key
      },
      timeout: 10000,  // Tiempo de espera en milisegundos (10 segundos)
      family: 4  // Añade esta línea para usar IPv4
    });
    return response
  } catch (error) {
    console.error('Error al subir el archivo a monday.com:', error);
  }
}
//Método que permite obtener las características de la Cotización
async function getCaracteristicasCotizacion(pulseId) {
  const query = `query {
    items(ids: ${JSON.stringify([pulseId]).replace(/"/g, "")}) {
      name
      column_values{
        id
        text
        ...on MirrorValue {
          display_value
        }
        ...on BoardRelationValue {
          display_value
        }
      }
 }
}`;
  const version = '2024-10';
  const response = await sendMondayApiRequest(query, version);
  if (response.data && Array.isArray(response.data.data.items)) {
    console.log(response.data.data);
    return response.data.data.items;
  }
}
// Función de utilidad para formatear números como moneda
const formatCurrency = (value) => {
  const options = { style: "currency", currency: "USD" };
  return new Intl.NumberFormat("en", options).format(value);
};
//Método que retorna una cadena en base64 que porteriormente se convertirá en un archivo PDF
async function obtenerDocumentoCotizacion(cotizacion, numeroCotizacion) {
  // Obtener datos necesarios de la cotización
  const mesesFinanciamiento = cotizacion.find(item => item.id === 'reflejo2__1').display_value;
  const descripcionActivo = cotizacion.find(item => item.id === 'texto__1').text;
  const precio = parseFloat(cotizacion.find(item => item.id === 'n_meros2__1').text);
  const numeroUnidades = parseFloat(cotizacion.find(item => item.id === 'n_meros__1').text);
  const costoTotal = precio * numeroUnidades;
  const renta = parseFloat(cotizacion.find(item => item.id === 'n_meros5__1').text);
  const porcentajeInteres = parseFloat(cotizacion.find(item => item.id === 'n_meros8__1').text) / 100;
  const datoComision = parseFloat(cotizacion.find(item => item.id === 'n_meros9__1').text);
  const opcionCompra = parseFloat(cotizacion.find(item => item.id === 'n_meros88__1').text) / 100;

  // Cálculos de montos principales
  const monto = costoTotal - renta;
  const calculoIva = monto * 0.16;
  const calculoSubtotal1 = monto + calculoIva;

  // Cálculo de la comisión y pagos iniciales
  const totalSuma = renta + datoComision;
  const calculoIvaPagoInicial = totalSuma * 0.16;
  const calculoPagoInicial = totalSuma + calculoIvaPagoInicial;

  // Cálculo de la opción de compra
  const calculoOpcionCompra = monto * opcionCompra;
  const calculoIvaOpcionCompra = calculoOpcionCompra * 0.16;
  const calculoTotalOpcionCompra = calculoOpcionCompra + calculoIvaOpcionCompra;

  // Cálculo del pago mensual
  const pagoMensual = calcularPagoMensual(porcentajeInteres, mesesFinanciamiento, monto, calculoOpcionCompra);
  const calculoIvaRentaMensual = pagoMensual * 0.16;
  const calculoTotalRentaMensual = pagoMensual + calculoIvaRentaMensual;

  // Formatear valores como moneda
  const precioActivo = formatCurrency(precio);
  const total = formatCurrency(costoTotal);
  const rentaAnticipada = formatCurrency(renta);
  const montoFinanciar = formatCurrency(monto);
  const iva = formatCurrency(calculoIva);
  const subtotal1 = formatCurrency(calculoSubtotal1);
  const comision = formatCurrency(datoComision);
  const suma = formatCurrency(totalSuma);
  const ivaPagoInicial = formatCurrency(calculoIvaPagoInicial);
  const pagoInicial = formatCurrency(calculoPagoInicial);
  const datoOpcionCompra = formatCurrency(calculoOpcionCompra);
  const ivaOpcionCompra = formatCurrency(calculoIvaOpcionCompra);
  const totalOpcionCompra = formatCurrency(calculoTotalOpcionCompra);
  const importe = formatCurrency(pagoMensual);
  const ivaRentaMensual = formatCurrency(calculoIvaRentaMensual);
  const totalRentaMensual = formatCurrency(calculoTotalRentaMensual);



  const opciones = {
    orientation: "p",
    unit: "mm",
    format: "letter",
  };
  //Imagenes de encabezados y pies de página convertidos en base64
  var imgData = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAABDgAAAQ4CAYAAADsEGyPAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAARe9JREFUeNrs3e111EbbAOAhJ/9fp4IsFWAqYKkAUwHrCsAV2K4AXIGXCjAVeKkAp4JsKnicCng19ihsnP2QtFp9Xtc5e0wCXkkzo9Hct0ajEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACgmGeKAACgn36ch6Psx3H6z2mBX7nPPncPg8DLsFCCAAyJBAcAQA+kZMY0PCY0XqWfR3t+bZ7w+JZ+3j27DMsGjmX65H9Nt/zzxZP/jvt4r0UA8JQEBwBAR6Wkxkn2eZN+NmEZHpMKX59dhps99v047fPv2Wey8qlLnpyJP/9IP2+aSNAA0E0SHAAAHZNmOLzLPrOWd+UhaZB9Ppd9pCU7httQ7LGZOl1m+3mhBQGM06+KAACgG1Ji4zw0nxjYJM4gmcVPtm/L8JhAmKspALroF0UAANCu+DhHmvHQxqyHoibZ5zrbzz+zz4laA6BrzOAAAGhJWmMjztj40KPdnmSfL9m+L7Kfp9a8AKArJDgAAFqQFuG8Dj9f89o30+zzPfv8pjYB6AKPqAAANOzH+cO6FvFxlOOeH4rXtQLQGRIcAAAN+nH+8JaPOHPjaACHs1SjAHSFR1QAABry4/whsTEb0CHdqVUAusIMDgCABgwwuRF9U7MAdIUEBwDAgf04Dx/D8JIb0ULtAtAVEhwAAAeUFhT9MMBDu3t2aZFRALrDGhwAMPwAe5r+mP98EX4ucDmt8JWL9DMGt3+kn3cC3rVlH9+S8nGgh3elhoGG+9R47Yr96iR9/i/8fBvVUSj/Zqpl+LlYcryO/Z1+3mfXs4US7x8JDgAY7kBwGh5fRVq36cqfT55s8zIbFF4o/X8M5W0pT8VE1o3qBRq8pt2Gakn5bSbp8/TaFrcXsuvZMyXfLx5RAQA4zGD8IpS/m9gXN2brANA1EhwAADX7cf5wR/B8wId4qZYB6BoJDgCA+l0P+Ng+Pbv855l1AOgMCQ4AgBqltU+mAz28+FiK2RsAdJIEBwBAvQb9aIq1NwDoKgkOAICapLU3pgM9vMWzy/BJLQPQVRIcAAD1eT/Q44qzNk5VLwBdJsEBAFCf2UCP68zCogB03a+KAABgfz/Ow0n246gju7NMn29P/v+r9HNa4rviuhtzNQxA10lwAADU403L219mn6vsc1NktsXK217eZZ/Jhn82z77rQtUC0AcSHAAA9ThpcduXZRMR2b9fZD/i5yIlO+LbX6Yr/+RT9m/OVCsAfSHBAQCwpx/n4Ti093jK6b6PkOTJjpToiAulfvVYCgB9I8EBALC/aUvbPaszEbEyqwMAesdbVAAA9veqhW0unl2GT4oeAB5JcAAA7O+4hW1eKXYA+EmCAwBgf5OGt7d8dhluFDsA/CTBAQCwh7QwZ9MWSh4A/k2CAwBgP228PeUPxQ4A/ybBAQCwnzbW37hT7ADwb14TS28UnAJ8/+zSoA9orZ+ahP+uxRDXSlgqHaChcdK6fug/46XwM0l2l/VR90qw8fqKM7/y5GiRMe4yfYx1YQsJDroWGMyyz+/pwrza8Zf5nlV36SIeLwh/hcdX6i2UNlDjAPUk+7xJA9SjDf8u9kVXWf8zV2qD1MYrYgU44+53pmmM9CoUS2js+s484RE/f6Tx0lJp1zrGjXX2ItXbdM/vC+FnwuNbeFyTR6IKggQH3RI7//Oav3NdgmSxxwXlOBR71rrX2XWzZVot89U29n+h2tT3OOD560kg9JDoM2Ctrb5ivbwPj8mNIn1C/PfX2e+9yurgVAmyL4HMKPucPJl6iEei8qTJdGWbyzRm+uqNPZXqbDX5PTnQuHmSvv88bTNe779mnxtjNMZKgqO9Ti/vlFZnKRQNZr49CWTygEXmtljgt61e8vqIn99Xgs19ZpLkweW3tP27Llx0UhvMj/VVlePs+jF2+NyPg5EXK+V/1OD28/qK9ZTfpVuomcLllw8kpxW/YhbrQJIDKHi9iEHy+9D8a4jzAHqW+q14jY9JjivX953XiHehePK7bvm44jwlqK5SsmOpdhiLZ4qglYBmeuBNrgab9ynYXPSgnGK53B54M6/zslhJZkxTgN9koBnrZZHqqJELz8pU+lfhcHcTnh7j3cox3o30/F8t97YGPEXE9hjv+iwMXjf249c19t9vi94Rzbb9YY9283sKUJpuS9/abMtNX/OyOrpt4Nr+7wHcZffHcG2US+YyK5uLgQTJs47uokfu/ltnsa7OQzuJqCJiXX1uOx5YeRy9qnctlPFlq8F6z/szCY5hdXSHnpZWxXIl4Oxc0qOhBEe8a/oi/Hx2tUuDhc91JzuerA9w0vIx5nd/Pg99xkDHyr1qX+Guz8+6jIPWD3WXcVa2zwvuww9X1VJiu327Z73/L3Q3GXkor+vumyU4Ko2Dzlsos32uFZdjTnT0ILHx1CLV2aKl8roI9T+Orm9GguPAF6Y2p6VVGgiGBmcRFCi/Wy1p/yx7D+7+PAyKUru7H1AfMEkX7j71AUX6iKsxXlzTwPXjAevy5a7ZMqlN/albLNe/FE0ebSjzWN//G2G51Z4YkOAoXE7Hqa+Z9vWcyz6nY7pO9DCxse7aftb02F+Co5JYT58UQ3HW4NDJnaTPx7QwUZxFMLeWR6tie4rPuy5CySx7aovxWd3jjh9jPFeuU7u76vP0uwHM1ijUR1Rpjz2u07x9Thso27sC5wrl+5d9HI+03H7XdFq5fhxihlgb59xtdjwxaD4d8hhyAMmo1evPNDuey4aD51fO/NJeKIJyflEEe3VyMQj9Mw2EhzAIzTvt/2XHdV3wTRoczjQNGK5TwFW0LfZpcP4wuIv7nh7r6sWANO5r9onJme/h8U7vdRhmcmNde7zd1R573q/HQON7Q4PXVwXPEcrX4z71N9YEx0TLabyNxr7mw4AOK14He3M9r1BnFw1eH5oag30c+nVd3zw+EhzVOriTgSU21pmtBDNTtd56XXxPgdd/BkgpyO57W4z7/iU7li/pjlYXz/uYRPoSHhMaX9KgdIyB0DQNYC+6WlcV6/coTac/5CMpVQYtYw222xwQjjWp5FrfXH8T+5nbgY4hj9L1/OOA6muSxlrnAz73vzeUmHJNU2YH5xGVkgPgMI47tU87vWmann7m7QqtDhhilj3e8c1fLznEthiP5zg7zrddaWtpOmrfZsY0IQ703mTlc9r3fiHV8W0Lge1EM+pk2ZoOzCHHkbcjuZ58SH3r2z4/spJu8n0Jw0985ompQ6/3YFaiMjs4MziKd3AP0+7CuJIbq2IH/z1Ny3eitZsAuB14W5yktjbrUOArubHecdgwu6hHfXtsZ987PICwLkI1/2cwWTmY43DXk+8ju57E9nTb13Fjuj7cjqxPiOP8a2dsJ/sPCpLgKNao4jS7MWRvixjrtPyuBZVjaIvX6XnXNjnvBzwgSn171/d7onlV7iehS8HJ7UjP54dj71uSoyfXh0OZHeKaLkjfi7FoCRIc20/Eo/TM/Qel8ZN3MdOg87YC53QhFlyWGxD1ZhCb2pW+HQNJx37ovmYWxjcL4KleJTlcH/65ptc9/tK/0AgJjs2dW/6c5InS+JelIqCFi+zMQL8Xpn0YxKZB26wDu2JNo+4GY46dOvqa2Cdeu57807ZcH/o3/rpQDJ0wUQTFSXBs5rn79ZaKgBZcD/W1cwMdxH7p6MA1f1NKVwav95oLDFOaBfhFSfzn+vCxw3X2MUhuPHVu/NUJE0VQnATH+g7OGxM2+6YIaMm197T3xrRra3KszMqbdmi3JDhgmOPItt7M1AezLi5MnWaKemzR+IsBkOD4bwcXO7eZkthooQhoycMrzJramLVmhjOI7fCrGf/QTGBw48jY33gsZbuPXVpwcuVRIjow/mItN0RKkOD4dwfX6alzXSDoo2XHDT8PeqPI+z2I7XByI1pqIjA4ZgEXL6cujP0F790cf/Fv1uwqQYLjyWBcEQj26Lz3DU6V/Ky4ez+I7XKwsdQ8YDjSrDXrFRQPmLswy8/r4Ls5/oLKJDh+XpRmoVvPZnfRV0VAB8SBSCPJyGeXD0k9QWhPB7FpHZAuBxvuyBzOPtN5x3zO6++q9zcxkXquJEo5b/OtKmlGgrF/ufGXNk7nSXCsdLKKYOdg0QwOuuIkPTPbhEvF3b9BbB9Ww392WSgI99xtNfusbzLmIH+p6VT2MZgJUCVgbisBPjH2r2RWdfzlMXd9c1MkOMI/szcmSmKrm4KDcWgsaG4oCJ27sPRrENuT1fCLzt6wECl0fxwZ+5tpR3cvXr8WobuLxL9vaRZHlxcVvUv11dVZfhJDDcvGosahJfyqCB68UQQ7uYtN18RXkU4a6vSvgjV66hjEfjp0orRHq+FLGB8+QFA35QfRC02ndJ/TpWn7+Wzb+Ejx3brrY9rf4zT2jY/wTVre5zwBftFgncXjnnaor4r1tUh1dr9mfydpf1+lOmt7plCT4y/cZCtt9AmO1GlYEGq7uU6MjoqDytMmzoEYoDc0ELxLn7/Cv++45efgZGVQGAepL9LPScfr6ij1tfMD9+d9WQ2/aJ8qEdJ8kuIP4wJK+NCBgDNeKz6nGYdbpQB6kT5nae2QeH2btbj/cfsXDW6vCzcsYl1dFhlfp38zT5/TNEvxXWg3SVN1/LUI1j051HiBxAyObp1k96HYXafjhi+mZm/QVSehgQRHHBBmA4p4Hlwf6LzP77gtCsxwWL3Q3TwJ7mN/9qbDwdmbcMAER+jXavhFHz2xEGm1c3ax5zk5Rgstp5wOrOMQ2+pZkcTGlnPlLgXN+TWujXHxUQza9zmOEnUWkwOTFuvsobxTuVets1hO8zQT5WNLxxPXQjvz+HpjbYYSJDjafTxlGf49lbBUJ5EurHlQ83t4THzU/TrES7M36LA4KDpJbzs5dMAUBxN13jGJA5Svde376h2e1DfEQdz7jgX8cUB0dIgBUVpU9Lgn7TavK8H24crXYLL5chujNpMbsZ2+rWuMlr7ndVpPpI0ZDodOgHehzuJjmmc1jktusvpaZH+8beH6V3VW5l0wg6OsvxVBORIc7QyI40XkdN9nXdPFKH4WK4P8o/DzOb3pnscXky4XmggdFwdFTb3h5ywNJKomDe7TYODqkInD9N0Xcc2L8Dh9ukuJjmnd9ZXuYnVtUdFNM/Li/7ssmuSJd/l+WM6t6UB9rAmOvzSdUv1O7FNnLW3+Jo0ja0+AZt/5KTu2+L1Nr2V0sAT4Sp3F+pq0VGenh5ihkmaYvg7tJDmqJKUE6+UtFEE5EhzNd3QHuyjlHV3axk3qzCeh2rT1+D2nmgc9cNJUW03B5lnFgV8cBDQ6nTNtK090dOW1qa9CjQmOFGS0vajoMgXFf4QtC8Xted2omqA6amHQuwztzgb4XEPAsAzje7uaQXQ5bSVV7w45jkznQJwJ+KKFYzzoOk2hvdkbp4d8/GYlyfG94X6rSlJqkcYBVTX9mH4X+kaPqJQ9J8Z88Gm1/duGB30v23pebeVuQ5HFEk+beBay5foo07Esw89n5vM7s6uBQ18WeiwapOXHfb9yMTnUY1B1eLnP86wV2upJCqp3XWQbmbFR8hy7brmdxnVGXtd4TF9C82uO5Iv05eumLLt6UrfUr16ObfZfVs6xjKeNDuAuuz+Ga6Ncmmp/2bH92UJf2tg4Mo0Zmw6Yb7JjezuwMWZcqP+0ofOtjWNsNF7Q11KEGRzNumpzMZ607Xgn91PqBN9vCAwaT250MNCPd0y/FVgf4eZJxxuD/7hOwyz0Y7HDmwJB2mLNoCe2m/PQnYROLPe7Bs+l+Nzr3co5NHnSfhap/XTqPIqPxWX7/TIlOdpaiLS2gUlKNDV5HLFeP4+8f4TRS31PG9e/06bGkWlWwGnDAfMhA9d3LY0nz5raWLrGz0OzszXjbAzXRDpl7AmOpu9Ed2aKUVr/Y7GyAvhs5eI51o4qlsnVPos+plkEd2k18liuHzp6rLGOKy0gmwZX8ffn6XnW+OhD28mcFy2cQ/nA5axPjTzV39us7q5DNx5ZqRpgNPloSuXzBRikNoLl+b5rt1UMmO8aHC/HhcOP656R2eJ6Kact3Ni8bPhYp7oDuuaXkR//0dgbQBywp6lzccr465EmN+7Ssb+u8Y0W92ml7FiuXXoLQqzf57HO6wjWUnt5HtpP3h0HytZdPO8XbWw7zXTa13kDffiizvMF6L+VWYxNengdbEuHfNXw9g4RMLcxY3HRdEIqH9eH5hZejybpnIDO+EURNGrS4WCnlY64A+JigC8Pdezpe7uQ5IgXvNeHCNTS3Yl4jG0mOSQ4qnnbUtvcazCUEiSHnB31EEykpOdSMwFaDpbnLT7ifNPw9g4xI/NNC+V22WIb/WoMxphJcDTLy/665+ADhjTV8nWLx7gI4XBJnHSMeZKjrWDQ3YPq9XbWw13/eOA+ISY2PmkhwBqvWtjmVVsHu/J2vj4Hy00npe5avmnYdFJqqlugSyQ4mjVJz70zvkAyJjnayubfN3HnJ22jtVcLp/VkKF9v8xD6M0shLe53qMFUntzwSjagS8Fy2330twa3VWuCI10zmva5zcpK47Emr2O/6xbokrEnOBYtbHMmyTHaQPKipUDyqMFjjOfUvKUinmhllTV9t2ef8+BQszckN4BdwfJxaH7G4NcOHPpdw+VcZxm3MePmpgN11mSMY/xFp5jB0Y6Y5PgzvoHCwjyjczmCY7xSzb3T5N25UPVuZHprz6EGUmeSG8AO04EHqps03Tced/S7ilh2ZO2mvxvc1iRAh4w9wdFmBxQ7gziTIyY6riU7RuNm6AeYvypXVffKfU+2dah1jBYjfj02UFzjswG6sAB8iwuc1mHa8Pa6Mv5pst1MdA10yagTHB3JsObv5o7Jjv/9OA/fs89F9plKeAyyzTW9WFfUxurWn9V2rzTZ11Qa/B149sapJgB08Hp6p5yri2PpFvb9D6cJtOtXRfCQ4Zx2aH+O0+c8dc753fA4hfzOFOpBiHXZ5KJXRy2dV/RHk3clq/Zhh5q9MfcqWKCgSdPby8aBtyMs56Oe1lf0LquzVwMqQ+gdCY7Hwfa0w/uXJzxm8T9+nP8TPMYBecwS33Vh+iKC/1UxEffDS5F7Ic0UazLh9q3CPp4ccKBqzRigSD/UxljxKHgF5z4mLW1zMsbzQzxCV0hwPA62P/Rsn6dPOpXoLgXO8XgWPX9eUvA/DLFNHqvxTg9I4uD5Y8ODsSoDoPeHaqNmxQEFuSPeP68UAYzP6BMc2eD2Jhvk3w/gwpXP9PiQApc84fHZAL6TlmH4GX5Jtj1l5/GkQjuZ7mh3edt7EcJBZ0ZsSijclyyD43C4O5jWigHKjLMA6DgzOB7FRR9nA7wQPyQ8UgInHuNn08c6YxmGn+Do+uNfjUtTnI9WBsqrd5fGUFZVEgrvD7g/+kOA4TIGgRGS4Hh0GYaX4FiVv6klvop2mYKMTx5j4cD+HvPBr8w8iEmM+OeJJlHuDUIHXh/k3uw2oASPOwD0gARHeHxdbDaQXoRxZHpjkBVXgDjPjnme/bz0BgGoR0pqvE99yUSJ/MuiQl8TkxuHenxQcgMA6iGWoDMkOH46zT5/juyYZ+FxVsc8SHRAJWmWQTyXYmJjokQ26trjKd9UCcBgr83WTGmQGIIu+UUR/OvEvBzp4cfg7Ht2MbjQEqDw4OkonTMxMdr0m0j6Jl8HqEz5xvI85ADVDA6A4fLWGxgpCY4Vzy4fgpWxDnrjhSA+tvJd1ht2Bt+z8JjYODeIKuSmwpo/swPvkzWIALppoQiAqiQ4/uvtyAe+MblxmwI4YEWatXGb/fE6SGyUcVXhd94deJ/M4AAAGBgJjifSoyqvw7iTHDFwu84CuQ9aBDxKM5virI2p0ihlWfZtJamsJwfu683gAIAarvOKgC6R4Fg/8I2D8bEnOaKP1uWAfx5J+R7M2qiiyuyNqWIDEDCjvqAsCY4NJDn+ce5xFcYstf9rJVFJ7D/nFX7v0I+nLFQNQGfH4AJmoDIJju0dbExyvAye1b628ChjlLX7kyC5sY/Si4um1+7qbwDGqZYbi9m1Z6EoG+O163SKBMfuDjI+Px6THJ9GXhRfUuABo5CSepIb+6nyeMqJYgMYLQtAA3uR4Cjo2WU4C4+PrCxGWgST7GPRUUYhJfO8KWU/i7KLiyavFB0g8B6tpSLo3/VeEdAlvyqC4tJ0t0V6Jv88HHiV/w6K63HMPRvJGNp68JjEvq4q/p4ZHEAX/d1G4JiNuV4r+sruWriWn2V19knRQ3vM4Kgg67hikP88jHNGx7kWwJD9ODdbqQbx0b6bCmUfB6JmzQBd1Mai8xLt/auz3xU7tMsMjj2szOiIAdEsPK78Pxn4YZ9kx3tWduFA6JE+rrtxtzKQyxf7iv3T/dPHRFJ/Nc0+7w84eL6s+HvTBssLoOv9xlHss82crayNcpOUgpZJcNQgXXgu4ifdgYyJjjjNejLAwz1KxzZX8wzNSvDftQFaHFj/kf4cP/cV17fI+6t4/s6z440zVT7WvL8x0XJT8XdfNFSmf2vtQA+C5ZCuScZc1fzVUn0BLZLgqFkKOuLnLAVLMRnwKnV4Q5l6/cbFloHqwiNYeYIgzsS4OeRsqficcNZPxe+vc9bK1R77bGAIdHV8t/zRzhXilTFXZYs2ruvxFfNVHtOkm+LC82au94sEx4EvhuHx9bKf0glynAbw8S7lcejvNDaLADJUbbbtePGMj3bMm7yQxjWFsr7pTU3Hfh8qvlI7vblmogkOgmfQGXLAPG3hunSq6CtZtrTdeE2V4BiO4+BNMb0iwdGgldkdq4P6aTpxXqSLZi8G+HG/0xokMAjxjktob5bVPIRW17a5DPUkOMzeIASJKobrroW+6siMgMrj7mWapdj0tV1SClrkLSrtd77xFWCfss9pejPLb9nnbXi8C9rlhfAEIwzNq5a2e5rO/9amP6bk677brzx7I7Ew23CoS4bqj5a2+17RV7ZoYZsxKTVT9IMh5ukZCY6OiUFOzNJnn3g392V4THjELHDXMvemIOMCtr/4OMq8I8e/b0L1as8kzStNcDCO0hpUIFiu6fqUZvxS3reWtnuu6AfjhSLoFwmOjksJjxgExVkdebJj2YFdM3hlaJq+6xyTAWcDKbt9Z2803ad4TWwDAZkiYIBjsmWL/UcvA+b4eE16BLQti7bGyelNZX2rr5ig/iBJ7XrWZxIc/bqw5smO+CjLaQitruh7pEYYirQAcNNuBrQq916zN1pYYNRq6If3ThEwUG0FzNM+BcwxQM4+X7I/PnzaemQjPYK5bKkYztP1rS91FgP57+Hx9fHfWxobdZFHjnpGgqOn0rT21y0O1HV6DOri1cI2vw2kDOqYvaE/GZ6DT6lv+a4w4/W5xW2f9yHozPbxIgXKq+fodYtB4qLF6+qXHtRXnoy6DT9vNsR9v5Xk+Me7A9fBsbKujwRHj6WsdJtJDhiKNi4qyw4Nbo72KIOrGmaiuKgP08dD3L1MU6jjQDzeFf5uKjUtjL3a6r+PUqKgk7MC0uMof4bHx2nW7WNbSY42k1Ix2Xvd0fo62pCMWm1vkhw/6/HDoc6b8Jhc+p7qgz1JcOxudJ0eOKUL7ZWagr0HjWNW9U54HOR/Uv6d1mYCPA6KP9Z8TZ5mP2IANV3ZhqnUNO2m5fPqtktJjnhe5knHsPtxw+umF0yNbywM7d5UmHUtyZESTduSUavX5y4l1dqc/fqxzmtNSjB9TOdNXr7nXU2I9YkEx/ZGFxvcn7HxdfwZuk9qDNhD1amXlzWtI+INKocb2Le9oGoc2O8djKVrchz03a4ZjLvLSNPavrF0nManrbb5lcRG/JRJWnxpYVz9ueU6i33hl7bjiZjYSLNsrkPxmwu1J6t77Hsds5BW1jv5sKGtSHLsQYJjfaM7Dv+ervWhrgZ9oAFsDDAWag56pRPBWLrITiv86l2Nr7g1g2PYpikYm5Ud3Kdnwy/C453G2Y42JMlBU+OuZQfGXUdpbHrRdNCczuU4Ti6b2Fjd96YDuHkHms5JqrOThutrktrJ/1K5Typ8zawj6x514bH865S4n1aoi5OVpOBkR3lLclT0qyL4T8M7DuvvEE1Sg453Oi/TdLcxs+4H7Kf196qnQXHVC2idr7gVlB7WXQfKOG9rcUZknN4fpxkv111L06Ax7u+7kvudT6V+PaA3FNFdn0M3Xh8ZHzF4l7X7OKtkfqi2n87LdylIryOhEgO9aVPj6ZiUyrYXkxyzlusrxhNxJsfikPFEur7HunoTQm2Jidh/L1ruX7vymvd4PsQZTHF/vobHhOcyJT9X62GSrmOvUj1MSmwjJjn+yL7TTH0Jjr06g8mG5Ma6Bn3QjqniiTbGDgbqsBzBObt2sBKq3cm5qavvs0BkY+27K0mkoxRgzFL91y2fSn2q2jlwwDzP2u95CJ3owyap3Z+nBOJDwLXn67uPnwRmh5glEpOezxssp88dSHA8jSdi/xzr7PO+jxSuzMh8daAxRmxncVb7xcjGa7uuOfFzfqBrWp5UEneVIMHxs1PIX+VUtAPPO6ZF6pTmLe77TA1C7y6YkybvXm3oN6r0HXHAXOfsjYnmd3B/hDCqV6rGu15fs3PrRtVzYJchdGoa+dMEYgyK4uevdJ1bbvm9GKT930rA1sRjL/E6OGtqDB2vt2ncPu1QneVJgw8pOF6kOvs7bH8MKq+jF+k7mkpiv8/281NbszjSTJz7MK5HW2Mf81J3W5wEx08fK3YOsZOcpix+zAzPn05POnCQEk/w8xbK65smw4C0Nd3yPLTwHHdKblQdlF/V3MdZf+PwFi1dJ1q9pndgKjUD17FZHJuC4K4/AhjLb97g9i5DtxIca+OKlbLpmnjNbnsWx13H67D28ziuoZL1NxeBQiwyGv55//Bsz6+ZpI7oz7TwzOzQU69TcmPXIjWHstRyGNAgta2pfwd7r/qWfiMmc6smN5YHuMBaf6OZweDYTEJo9txitDwOtee52uRrY9Osybli38v7lrc/xpus7z3SW9zoExwpSVD3q4+mKYCIyY58hetpzfs9C4+ryrcVHHgWDEFgPT428ZhZWkX9ds+gz0C+h0b8pq1zA0IaCpgXSqJXAXOcxWF2V3VHLT8eP8bHD9uasd9LZnA8DvYPOQDKF56Jszp+pITHdZ70KPpKu5iISf/+Y4X3V9ft3mI3DFCbbfr6UDM5Ut9xER5ffT3d46vmB1ov5IWm14ivIz1uA0KacCpg3stJk6+6TY9ZXir2vbxpa8MpBlmOsMxnkvbFjHoNjtSZNp01Xn0e8umKu/drgqxJ6N6znRZuY4jilMdZi9v/uPIa6r3PsXQRnKU+bt+BY90Li65qI1E7xnU/5qH+2Yp9GRBeNrk2FuOTFj68HOk5VpeT0OCjI/HVm1mdxSB9quir1VeMo1pc5+hzGGcCOx6z2bQ7jH0Gx4eODXSPws/FhfLPpIPl9tWpwwB1IXEXk59f4iytNFvrpEy2Ps4IizNBsk98I9Sf6UJYRx93OrDFGke37keqv/lIz+2Z7o0mAubgBtA+2pgRYObNftp8O9dor2dNznbqq7G/ReWdJlDa0qv3GGoAmF00bkI3Xqc5Cem1cfE/Vl4dF9Jg7I+Vf/sq/ZweaF9uDnzOT7W+xnweabAfr/UXqp+GAubj4PXXvbgWpJk3sc6+KP5KXrWVaEh1Nx/pNS0e8yfNb7PRzuBIb05xAao2QIah6vLspGn6xL7rfOUzPeDA8D6YCjkYI14McZKu+XDocyz2mW+DWQFVHBVdl67mOosJ/DPFX0nbsyHHuo6KG/Q7jPkRlTeqv1KwI2PIkAen8+AVyKuG9mhK7vcx16lrPhz0OhLXUnurJPoTMKfHi+aKvx/1tVJvy5HGJccWG91uzAkOd3PKuxposAOrrKz+aH7ox9FavECPdmAw4rcHTJ3SNHieLYLZb73qm7M6i/U1VwWlr+NdmMUxxthEHLvFLyM9GWOjsEBLOXFQbPYGYxiYzoNZHPH4m5iyO9HiWmnjFyGM7lXfE3e8aOFaIslRzl3LdSbJUc59aDm5sPJY2Ni80vw2G+sMDo2ivDOzNxiRsQ9K3w78fJ9q4qNcJ+BYtdNw8DUP1uQoGii/7sIi9pIchS2yz/MuvII7zZga28xE17Mtxprg0CjK+eTNKYxsUBovlmOdsXSZniFn2G08Dkpfj+ywJ2qeFs61m3SuSXKsd5MC5UWH6iwmOSw8ul5sx/Gm5+su3QhJMxPnrmdEY01wTFV9YXdZp6GTZ4yD0tjuxxboL9IgwQV6HG08tu+xzFb6lBYShLbOtedhnG8x2hYox9mCnZwxmPoLiaknY4Ts87KrfemIZt8sYz1ojpuNLsGRnsHVWRVzF8Z3hw9WvQ7jSXK0sfL/pMVrwVTzHsUU+jyIkqin7XPtPt71DhayjmKA/Lzrs4PTrJKXQWLq4ZXxadbGsuN1NvQkRzxnXpppu93oEhwr03I1jN3BzmvrbjD2AWkK/pYDP9R88OJ8H2c7z6fQD62d3/QhiGJ059tFCprHOA5dpOCsN+u6xbghJabOwjhvkF6mfnTeo3PsNAwvkZg/GvTWWG23UT6ikrJesbMyXXU9yQ1YGdwMfDCaL+7WxvG9aLFeF1r3f66LL1NSoO/iOfvWQJAun2/Z52UYzysuF+k687qvd57TYxlD6SOLmIfHxMZFH/vRlEgcyuzEvC7ErQWNdQ2OfKpgzMa+DqaerboJkhvwn/4i9RVDG9g8BLUtDji9rrt718W3PR4U3qeA8aVZG/QoCHsehjulfhF+JjYWA6ivZeojhxw75MH0adcfRylQXzc9P7/y88cM25J+GXsBxA43TT2L05mWIy+OS3e8YGfwN5Rpqnkys81+725k2+3boLAvd5fzxEZv7zYy+mvLaRhOouM+HcfLoSQ2tsQOQ0l0LFMf+tsQEhsbzq8+1dUiDCgx2IZfFcE/J0DsjOc/zsMs+3kexrW6/8NK+hasgUJ9xaesn4gB4HXo5xuZHoLBjkx1/LvFPo8dg8Lsx0XW1mM7+ZB93ofuzbiJg/CreO2W1GAA51xsz6fZOXeWzrl3PRuL3qXz8WYs52MKPhdZnR2nPvIk9GdmYqyjOJb5OoYZbyt1NV2pq66JsehnSY39SXD89wSIjSsmOk7SCTAd8OF2KdCBvg1EX6cL5XWPBqHxotmluzNtJRo+a8WF2/pDoiM8Jjtm2c83LQ8M80F51waBZ6lcfk/9weQA/UJ+vN9Cf5J0Z2kcFYO+V+n/HdccBK6WyzL0/I76k3Mult27DgfOsay/pqTGMoxU/srtlJw66UA/KamxO9ER++dZaD+ReJfGJBL1ddazItgunQB5pm8ykMOKJ1DMsn/q0smULuS3TV+c0zTDpo/1NjSYPMuO8VkLxxgHaOcNbrK1qXw9SIguU2KjUwP/rNzigP3PhgfurZzzA7suHqW2/iYFq8cNDAAXaVC+6GF5resX1gX5y/DfR2WXQw4c15TN0Zr2dBf++6jU3diCgVRWb9K5d9zSbixSfXxLfamAbHs/GccGr1KdtRFD3Kc6y+vL7MX1dXWc6iivq6MG6uRrqpOlGpDgaPsEWM3K9nFxvHgSxWfsOjl9UIJDgqOvCY4nF8kuTVON5XHV5Ts1DbeTNt8YM/SB/PFK0J7fqS/bx+WBbPz5VwpiF0oYNp5z8Rx7kYLnOpMey/RxLtZXZ5OVfvJVqH+W112qsz/Sn+8Ez7XUVT4r76jkOXa/ck1TJxIcvUp2vArdn9kRT6R8Ou9dx8s0dh4f0n/mA+S6LgD5xTrvaO5XOpv7lo51NSB4kX7uc7z5MUXfVgLc1u4ApqRVfkxVLxLrgva8Tv/KL+pda98rCdFpw31Efs5f9eVCmpXV93D4O5KSG+3X89NZC/fqA2oPzPLrTdFHgfLxUQgDnzHU8X6xzNjon1lNEk+txiz/mW1mVpMEx9AuKNMUlDcxXXfXIH4RBjodbc0AeXPjHkCnv2Fq89COcbIjAdD7AdfK9McXof6ER57Y+trXcz4NFOJaJod6Znmefc4MPAAAhk2C47ABTQxiVqc37QrkqgQ1MfDL72Kb+gT9CeiPw39nt0Tr7gosVv4cz/W/h3jO17y6eSyz0S9+BwAwJhIc7Q3kq64ibvoTMPT+MV/EcjVBvM4yPCZ4o3+ed/XYAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAANOmZIgAAoO9+nIdJ9mOWfV6t+etv2efu2WW4UVIAwyXBAQBAb/04D0fZj+vsc1Lgn99nn5tnl+FUybFnuzvOfnzc8NcxmXbm2KF5vyoCAAB6GmjF5MZt9jku+Cvx38+yjwQH+4ptaerYoVskOAAA6Ks4c+NYMayXEkCbyuf+2WW4U0qjbBexTRxt+Os4A+NeKdFXEhwAAPQxSJuEYo+ljFkMZG83/N0i+7xWRKMUHy+Zbvi716ltQC9JcAAA0EeTHX8f70LPVwL9qSIDGDYJDgAAhiYmN54/nWr/4/whyTFVPADDJMEBAMDQrF1HIPt/i2D6PexrmX0ut/wdtEaCAwAAgEKeXT4kMS6UBF30iyIAAAAA+s4MDgAAWJFeozkJ61+xugyPj8Dc1by9fJvrtrdMj9cMoVw3Hed9KtdFg9tcBK9F7VL7mKa6OmqibRTYl+ma/VjUce6vvMJ50yt779IxL7WMcp4pAgAAehD8/Nh74Hu5eeybXjv7Pjy+enZS4OtisHOTfT5XCbzS9s7T9o7q2F72nRfpO/fxus5AssJxhnScV1X3o0Jd3qXtzUsGwBtfwZt91+sNv3cbtryitegxbzsfnrbzGs6dfx1P1WPfUo7vSrSPSm2jSHmVaKvLdB5eVGibs+zHm1D8FdfLlWOW7CjAIyoAAIxWvJOafT5mf/wz+3woGBCHFADFYOU2Bq0pOCq6zXx7sxJB/+r2vqQ7wF0v2yrHGVLwl5frUcltXlSoy3gX/Tr73T+zz4mzorHz7kt4TJSUaR8nVc65AvvzoURbjds9z37ne5ohVOT7Jym5dR1CqTY2SW35e9pHdpDgAABgtEFWCrD2DRymKQA5LrDNOraXB3lHHS7b65rKtdBxpoD5e9hvBksMJr+kxAyHaxvHKZlwUsM5N6uprVap8+Mi7TMd7/ew3yuq4zY+pn1lCwkOAADGGGTlyY3jmr7yaFewk2YXTGva3sOsg46WbUxszGo8zi8N1+UHgeTB2sZxqqujms656xqSHLM99+HLjn9zXdPxPuyrWUbbSXAAADBG5wUD4oeFBUsEOx+3BOHvC37PsuC/O0lrGHSxbOs8zumO4yyT3Ci6zVlKSFGT9EhJ0eTGffoUcV30UZGS7ku0z+MNx3xygLYp+baFBAcAAH3w+snnbMu/vVvz718/CbR2PT5xmX2eP7sMv8VFE9NChM/T/98W+Mw2/P/jHYHdp7S9Z9nn+cr2bnbs57uVP89rKKO93hCREhHbjvNmw3F+2vHV7zds76JAADlfs823YXfi6vxAgXPb5862Oj4rea6VsWsmw306v35L591v8c/Z57RA8F/XujSxTbxNbeW31FaKnBfvNvz/VzuO9zQd79O2uW17R2ZxbOY1sQAAdN7Ttyb82D5H4H7HWxZ2BQen696okd5icJFtOwbp37cF+Wu2vy1Qjm+eONuwvbdpTYhNCZnpk3+/rKmMDiG+9vLthuM8y/b377B59sd0TTnvmhVzn4LVxZptxjq8SY+izLZ8x8cQir8VpCfnzv2OOqq9XWx47eq/tpvqavlk3+O+ztM5t22mziSdIxd77OZZtr1P68ov2/7rdM5PNvzuccn/n29vXT8T2+Vix/Zi4uQm8B9mcAAAMDbb7qrOd70uNPv7GIzVGQQud/z95Za/mwyoXrbN4jhac4c+BrTb7tqf7grWs7+Pd9C31fd0ILM42rYt3RaTGK+3vQY1JTp2zaR4t8f+na5LbjzZ/lVThZW2t+281yY3MIMDAICxiYHUpsD3665fToF22QBjW2AW13v4KwtqLjYFO+kOch9smx1wnGZMnKUAbt1xvgzFF2TcFtDO0yyNIuLsmZMt230X9nx0Z8zSI2HTbeW/rj1saB+xrm43/JP4KtaTEvWeW+xKahY4h7f9zqZjj29Fud+yvzdhc/LzXstaT4IDAIBRWfc4SIlgbRYe70YfldxmnOYeg5XJhn8S13uIgfRVCs7vn/5+T8r2bsdxxvKLsyLicd6seSThrmA9TML22StXJfb5Pu1P4cdjKGVb+d0XTC6snkeLLd9Z5dGNQ87MiAnTTY+XPbyBJR3P1dNER+oDFppPOR5RAQCA7cF0nHkQXx36Z3hcKHFS8at2JVbi98Y1H/6XbSsGPrOaFk5s2mnB4/xzj+PcNoNmWTRRsmJecVvs9mLL31VZR+JrnXVVYcZHme9e7Ghb0TQ8JjrieX9tAdH9SHAAAMCKGGzHICMFGzGp8T0F5JM9g52bAsF/LgY5MZnyT7KjL+WXgrrKx1kw2bF10dYK+7wMW6b9d/R1vH2xra6+Vfi+ux3Jgq6dD7vWecnFdh/P89Vkh+RaSRIcAACMXkpqxOD6Swy2Y5CRgo1JzcFODHTiehrLEr/2kARIQc/H9HhGp+1znOFxZsf1Hsf5V8Xfs85G85YV2taibweZkhyXJX4lT3Z8j0nWPiU42ybBAQDAaMUgOi18+b8UXB98engK0F6mgKdMgBeDng8p6LnoQVAXF298Hh5nc5Q9zhjQxcDuoqeP6cDT8yGes/F8mJf81Ul4THD+6fGV3SQ4AAAYnTRj42EdiBRMF7UIj2tp7HW3Py4gGAOelAB4m4Keom9GiAF/XJT0ex+C/zibo+JxRnHhz1tJDlbP3b7ue3wUKs3m+C08Jv4WJX59Eh4fX/moFWwmwQEAwBgDpPiqyQ8F/nkMQOJMi9dZYPIs+8Sfn0KNr2mMa3PEoCf7/FYyCXAcNr8ys4vB3V7HWSKwfVFxF6db/u6+Y+13KI5r/p37npwL9ynxFx/jymc5FV3s9EMfZnC1RYIDAICx+bIjSLpLAcdvKaFx0dRz/2uSALu2e9zH5/PXHOeu4C7W12pCalu5TCskDY537G+X1ueY9qy6t5VdlWTUccVtdfVcWKZkRzwP8pkdyx2/dt6HtXja8KsiAABgLFIguy1APEszNLZ9x1Eocec5vmI2hI3TyhfpLu7aJEAM/NMbPGJSZtOd+3eh/HP9hyjbuJ+3BzzOVwUD2Ye34JR8/ef7LX+36FgzftOz0y6+KWXTbKn4tqJ4zt3XVFffOtTX3G7pay7TmhxPz4X7dC7P0yyN8y2biOtxfNKr/5sZHAAAjMm2Rfrmu5Ibye2WIHydbcH4ZNcvl3ztaldNCx7n2yLfkQLBu4pB8NNAdLKjXXztUNAcy2DWs7pfbPm7fOHcosc/23HO3HTouJdb/u7/CpwPF2F74tK6NGtIcAAAwKO/dgRXR+k1smXXDdgW6ExS0LpLH9YWuCsQnO5TVk/L4GrLv52mmTNFfNkRLDYVNE92lN9x2tdeWZmVsMn5rkeEVo5/2wKby449SvTHlr+bFVxL5a9AKRIcAACMybYA+t2O4CrO3Cj9msb4jP2O7V4XCHbelwj8iziuu2ALzKr4WGDdgG1T8u+ebG++o1w/bluMMSWsbneUxTzVXxPeb2oHK4//HPqu/aEef7nc8fe3216BunL+He2xjaZtS4zF49j6NpTUFt5V7MtGyxocAACMydbHRVLAG9cEuEsBxjQFGWUSGzEZsUjB/HFaCyIGX9ebtpt9/sz+ffw3i/wudArqjtP2p1u2V+URihjcX6djvU8BdNzW79l/n+1RvldbjjOWZ3y1bfw3NyvHOVkp57LHGfd126yGODvgXSr/5ZNAfrYjYL5P31+nb1uOMX9bzNXKvk4KlEtZ2wLjOLPga3xcKG+/qayu9pkdEZNE2ffFx78+bGkb8RWoi9SG7lf+f15X2yxSwqsz0jEvttTdLJXxVdr/+3Q+5Ofi+Y72udCdS3AAADBiKXGxLeiYpiB8H3HhxB8rQUgM5uOige/D5tkC/9zRLbntGBTdbDjWGKTebwmSZinIqi1oSse5LSA/SoHbeYXjnK/ZXlycdL4jAI5B5HWFwzktufhlEfOwfZbKccV9LWPboxMPr1BeUzefa9juZWoX22bMTEP5ZE6so66uURMTZN+LHG/J86HJmUW94hEVAADGpo6p7PcVkgGnof61NN7uCMLbWHTxEMe5MdkQXzcb6n+LzGnJt7AUkoLStt98MQ8trOmS6i++SafOdTIevrOrwX6a9VJ38iV+51lgLQkOAABGpYa3ksQA43nZ70jBzuuagsv4HW/TsWxz1nQwm4LNeJzLmo5zZ7IhJTk+1Viu8wMW0eUeQf7esxVSouGypXMvT3Isavi6h/OpYwuLrjvmeagvyXEXdic1R02CAwCA0UlBx9uSwf9DYJj97ssYYKRAvkqSIyZH9gmg4+++LDLDYCWgbDrJEY/z5Z5Jh5t0nPOC2zzbM3iO23l+iJkbG+qkbNksUkA/r2EfPoWWZpKkc+d1OneWFb5i9Ty861F/83KPtrl6zMvARtbgAACgj7Y9IlIo6EnrN8TvmIXHhRw3rQ0QA4q4BsF/nntPa07EfYnrZ0zWBOhXGwLc07So6MmObefHGo8pLrJ5UzbASeuOPE/7GLd3tKU8P9dVQek4z9KimXG7cbHIaYEgvtJxpm3G31+khRrztUAmW37lLh1z2e3t1f6elM35lnr5px09ma2zqKF+4va/pu1PtxzL4skx7X3urQT98/T64Lxt7Hpdb942yibsFm33OfkMrhJtc/nkvDdro0i7UgQAAPAoBR//ClyKBhbprSdHZX9vw++Hqt9TdjsFHnMJh9z+oY5zR73ed+3uf3qjxqSNfUxvDFpNsi3bmCmwZj9a25cW+5z7vsxMAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP6fPTgkAAAAABD0/7UzLAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAiwQYAG2IKHwV4dmnAAAAAElFTkSuQmCC";

  const doc = new jsPDF(opciones);
  /* const ttfBuffer = fs.readFileSync('/home/sistemas/Downloads/arial-nova/ArialNovaCond-Bold.ttf');
 
   // Convierte el buffer a una cadena base64
   const ttfBase64 = ttfBuffer.toString('base64');
   // Define el nombre del archivo donde se guardará la cadena base64
   const outputFilePath = 'fuenteBase64.txt';
 
   // Guarda la cadena base64 en un archivo de texto
   fs.writeFileSync(outputFilePath, ttfBase64, 'utf8');
 
   console.log(`La cadena base64 se ha guardado en ${outputFilePath}`);*/

  // Selecciona la fuente que deseas
  const arialNovaCondTTF = fuentes.ArialNovaCondTTF; // Selecciona la fuente deseada
  const arialNovaCondBoldTTF = fuentes.ArialNovaCondBoldTTF;

  // Fuente normal
  doc.addFileToVFS("ArialNovaCond.ttf", arialNovaCondTTF);
  doc.addFont("ArialNovaCond.ttf", "ArialNovaCond", "normal");
  // Fuente BOLD
  doc.addFileToVFS("ArialNovaCond-Bold.ttf", arialNovaCondBoldTTF);
  doc.addFont("ArialNovaCond-Bold.ttf", "ArialNovaCondBold", "bold");
  doc.setLineWidth(0.3);

  let saldoInicial = monto;
  const tasaIVA = 0.16;  // Tasa de IVA (16%)
  const moneda = 'MXN';  // Cambia a 'USD' si prefieres dólares
  const opcionesMoneda = { style: 'currency', currency: moneda, minimumFractionDigits: 2, maximumFractionDigits: 2 };

  // Crear la tabla de amortización
  let amortizacionData = [];
  // Variables para acumular los totales
  let totalPagoCapital = 0;
  let totalIvaPago = 0;
  let totalInteres = 0;
  let totalIvaInteres = 0;
  let totalPagos = 0;
  let subtotal2 = 0;

  // Recorrer cada mes de financiamiento y calcular las filas
  for (let i = 0; i < mesesFinanciamiento; i++) {
    let interes, ivaInteres, pago, ivaPago, totalPagar, saldoFinal;

    // Si es la última fila, usar valores específicos para el cálculo
    if (i === mesesFinanciamiento) {
      // El saldo final es 0 en la última fila
    } else {
      // Cálculo para todas las filas menos la última
      interes = (porcentajeInteres === 0) ? 0 : saldoInicial * (porcentajeInteres / 12);  // Interés mensual
      ivaInteres = interes * tasaIVA;        // IVA del interés
      pago = pagoMensual - interes;          // Pago mensual constante
      ivaPago = pago * tasaIVA;              // IVA del pago
      totalPagar = pago + ivaPago + interes + ivaInteres;  // Total a pagar
      saldoFinal = saldoInicial - pago;      // Calcular el saldo final

      // Acumular los valores
      totalPagoCapital += pago;
      totalIvaPago += ivaPago;
      totalInteres += interes;
      totalIvaInteres += ivaInteres;
      totalPagos += totalPagar;
    }

    // Agregar fila a la tabla de amortización con formato de moneda y dos decimales
    amortizacionData.push([
      i + 1,                           // Número de pago
      saldoInicial.toLocaleString('es-MX', opcionesMoneda),  // Saldo inicial con formato de moneda
      pago.toLocaleString('es-MX', opcionesMoneda),          // Monto de pago con formato de moneda
      ivaPago.toLocaleString('es-MX', opcionesMoneda),       // IVA del pago con formato de moneda
      interes.toLocaleString('es-MX', opcionesMoneda),       // Interés con formato de moneda
      ivaInteres.toLocaleString('es-MX', opcionesMoneda),    // IVA del interés con formato de moneda
      totalPagar.toLocaleString('es-MX', opcionesMoneda),    // Total a pagar con formato de moneda
      saldoFinal.toLocaleString('es-MX', opcionesMoneda)     // Saldo final con formato de moneda
    ]);

    // Actualizar el saldo inicial para la siguiente fila (excepto en la última fila)
    if (i !== mesesFinanciamiento) {
      saldoInicial = saldoFinal;
    }
  }
  // Agregar la última fila después del ciclo
  let ultimoPago = calculoOpcionCompra; // Saldo inicial se convierte en el valor de la opción de compra
  let ivaUltimoPago = calculoIvaOpcionCompra; // IVA del pago es el IVA de la opción de compra

  amortizacionData.push([
    parseInt(mesesFinanciamiento) + 1,                          // Número de pago
    calculoOpcionCompra.toLocaleString('es-MX', opcionesMoneda),  // Saldo inicial igual a la opción de compra
    ultimoPago.toLocaleString('es-MX', opcionesMoneda),          // Pago igual a la opción de compra
    ivaUltimoPago.toLocaleString('es-MX', opcionesMoneda),       // IVA del pago
    0,                          // Interés en la última fila como número
    0,                          // IVA del interés en la última fila como número
    (ultimoPago + ivaUltimoPago).toLocaleString('es-MX', opcionesMoneda), // Total a pagar en la última fila
    0                           // Saldo final es 0 como número
  ]);

  // Cuando muestres la tabla, asegúrate de formatear como moneda
  amortizacionData.forEach(row => {
    row[4] = row[4].toLocaleString('es-MX', opcionesMoneda); // Interés
    row[5] = row[5].toLocaleString('es-MX', opcionesMoneda); // IVA del interés
    row[7] = row[7].toLocaleString('es-MX', opcionesMoneda); // Saldo final
  });

  totalPagoCapital += ultimoPago;
  totalIvaPago += ivaUltimoPago;
  totalPagos += ultimoPago + ivaUltimoPago;
  subtotal2 = totalInteres + totalIvaInteres;

  // Definir estilos comunes
  const commonStyles = {
    valign: "middle",
    fontSize: 8,
    font: "ArialNovaCond"
  };

  const leftAlignedCell = (content, fillColor, textColor = [0, 0, 0]) => ({
    content,
    colSpan: 1,
    styles: { halign: "left", fillColor, textColor }
  });

  const rightAlignedCell = (content, fillColor, textColor = [0, 0, 0]) => ({
    content,
    colSpan: 1,
    styles: { halign: "right", fillColor, textColor }
  });

  const centerAlignedCell = (content, fillColor, textColor = [255, 255, 255]) => ({
    content,
    colSpan: 3,
    styles: { halign: "center", fillColor, textColor }
  });

  const createRow = (leftContent, rightContent, thirdContent, fillColor3, fillColor, fillColor2, textColor) => [
    leftAlignedCell(leftContent, fillColor3, textColor),
    rightAlignedCell(rightContent, fillColor, textColor),
    rightAlignedCell(thirdContent, fillColor2, textColor)
  ];

  doc.autoTable({
    margin: { left: 15, right: 15 },
    tableWidth: "auto", // Permite que la tabla se ajuste automáticamente al ancho disponible
    startY: 30,
    headStyles: commonStyles,
    head: [
      createRow("Meses a Financiar:", mesesFinanciamiento, "", [255, 255, 255], [250, 226, 213], [255, 255, 255]),
      createRow("Descripción del Activo:", descripcionActivo, "", [255, 255, 255], [250, 226, 213], [255, 255, 255]),
      createRow("Precio U. del Activo:", precioActivo, "", [255, 255, 255], [250, 226, 213], [255, 255, 255]),
      createRow("Número de unidades:", numeroUnidades, "", [255, 255, 255], [250, 226, 213], [255, 255, 255]),
      createRow("Total:", total, "", [255, 255, 255], [255, 255, 255], [255, 255, 255]),
      createRow("Renta Anticipada:", rentaAnticipada, "", [255, 255, 255], [250, 226, 213], [255, 255, 255]),
      createRow("Monto a Financiar:", montoFinanciar, "", [255, 255, 255], [255, 255, 255], [255, 255, 255]),
      createRow("IVA:", iva, "", [255, 255, 255], [255, 255, 255], [255, 255, 255]),
      createRow("Subtotal 1:", "", subtotal1, [255, 255, 255], [255, 255, 255], [255, 255, 255]),
      createRow("Intereses:", totalInteres.toLocaleString('es-MX', opcionesMoneda), "", [255, 255, 255], [255, 255, 255], [255, 255, 255]),
      createRow("Iva:", totalIvaInteres.toLocaleString('es-MX', opcionesMoneda), "", [255, 255, 255], [255, 255, 255], [255, 255, 255]),
      createRow("Subtotal 2:", "", subtotal2.toLocaleString('es-MX', opcionesMoneda), [255, 255, 255], [255, 255, 255], [255, 255, 255]),
      [centerAlignedCell("", [255, 255, 255])],
      [centerAlignedCell("PAGO INICIAL", [249, 95, 33])],
      createRow("Renta Anticipada:", rentaAnticipada, "", [255, 255, 255], [255, 255, 255], [255, 255, 255]),
      createRow("Comisión:", comision, "", [255, 255, 255], [250, 226, 213], [255, 255, 255]),
      createRow("Suma:", suma, "", [255, 255, 255], [255, 255, 255], [255, 255, 255]),
      createRow("Iva:", ivaPagoInicial, "", [255, 255, 255], [255, 255, 255], [255, 255, 255]),
      createRow("Pago Inicial:", "", pagoInicial, [255, 255, 255], [255, 255, 255], [255, 255, 255]),
      [centerAlignedCell("", [255, 255, 255])],
      [centerAlignedCell("RENTA MENSUAL", [249, 95, 33])],
      createRow("Importe:", "", importe, [255, 255, 255], [255, 255, 255], [255, 255, 255]),
      createRow("Iva:", "", ivaRentaMensual, [255, 255, 255], [255, 255, 255], [255, 255, 255]),
      createRow("Total:", "", totalRentaMensual, [249, 95, 33], [249, 95, 33], [249, 95, 33], [255, 255, 255]),
      [centerAlignedCell("", [255, 255, 255])],
      [centerAlignedCell("OPCIÓN A COMPRA", [249, 95, 33])],
      createRow("Importe:", (opcionCompra * 100) + "%", datoOpcionCompra, [255, 255, 255], [250, 226, 213], [250, 226, 213]),
      createRow("Iva:", "", ivaOpcionCompra, [255, 255, 255], [255, 255, 255], [255, 255, 255]),
      createRow("Total:", "", totalOpcionCompra, [249, 95, 33], [249, 95, 33], [249, 95, 33], [255, 255, 255]),
    ]
  });
  // Asume que la primera tabla ya fue generada con autoTable
  const textoTabla = "La presente cotización es solo para fines informativos y pueden cambiar en cualquier momento sin previo aviso. los plazos de entrega dependen de la fecha de la firma del contrato especifico, de la disponibilidad del activo a arrendar y de la exhibición del pago inicial, no incluye las primas de seguro, el cual es obligación del arrendatario contratar con endoso preferencial para Smartfleet, SAPI de CV., cualquier cancelación puede ser penalizada con base en el contrato.";

  // Obtener la posición final de la primera tabla
  const lastTableY = doc.lastAutoTable.finalY;
  // Justificar el texto
  // Crear la segunda tabla con el texto
  doc.autoTable({
    startY: lastTableY + 1,
    margin: { left: 15, right: 15 },
    tableWidth: "auto", // Permite que la tabla se ajuste automáticamente al ancho disponible
    styles: {
      font: "ArialNovaCond",
      fontSize: 8,
      minCellHeight: 10, // Ajusta el tamaño si es necesario
    },
    body: [
      [{ content: textoTabla, styles: { halign: "justify", fillColor: [255, 255, 255], textColor: [0, 0, 0] } }]
    ]
  });
  // Añade una nueva página
  doc.addPage();

  // Configurar la tabla de amortización en jsPDF con autoTable
  doc.autoTable({
    margin: { top: 28 },
    headStyles: {
      valign: "middle",
      halign: "center",
      fontSize: 7,
      fillColor: [249, 95, 33],
      textColor: [255, 255, 255],
      font: "ArialNovaCond" // Especifica la fuente aquí
    },
    styles: {
      fontSize: 6,
      font: "ArialNovaCond", // Especifica la fuente aquí
      fillColor: [255, 255, 255],  // Fondo blanco
      textColor: [0, 0, 0],
      valign: "middle",
      halign: "center",
    },
    head: [['Núm', 'Saldo Inicial', 'Monto de Pago', 'IVA del Pago', 'Interés', 'IVA del Interés', 'Total a Pagar', 'Saldo Final']], // Encabezados
    body: amortizacionData,  // Datos calculados de la amortización
    footStyles: {
      fillColor: [255, 255, 255],  // Fondo gris claro para el footer
      fontSize: 6,
      font: "ArialNovaCondBold", // Especifica la fuente aquí
      textColor: [0, 0, 0],
      valign: "middle",
      halign: "center"
    },
    foot: [[
      "",                             // Primera columna
      "",                                    // Saldo Inicial vacío
      totalPagoCapital.toLocaleString('es-MX', opcionesMoneda), // Total Pago a Capital
      totalIvaPago.toLocaleString('es-MX', opcionesMoneda),     // Total IVA del Pago
      totalInteres.toLocaleString('es-MX', opcionesMoneda),     // Total Intereses
      totalIvaInteres.toLocaleString('es-MX', opcionesMoneda),  // Total IVA del Interés
      totalPagos.toLocaleString('es-MX', opcionesMoneda), ,                                    // Total a Pagar vacío
      ""                                     // Saldo Final vacío
    ]],
    didDrawCell: function (data) {
      if (data.section === 'foot') {
        const { column, cell } = data;

        // Aplica el estilo a las columnas de interés (2 a 6)
        if (column.index >= 2 && column.index <= 6) {
          // Obtener las coordenadas de la celda
          const startX = cell.x;
          const startY = cell.y;
          const endX = cell.x + cell.width;
          const endY = cell.y + cell.height;

          // Subrayado superior
          doc.setDrawColor(0, 0, 0); // Color negro
          doc.setLineWidth(0.5); // Grosor de línea
          doc.line(startX, startY, endX, startY); // Línea superior

          // Subrayado inferior
          doc.line(startX, endY, endX, endY); // Línea inferior
        }
      }
    }
  });

  // Calcular el número total de páginas
  const totalPages = doc.internal.getNumberOfPages();

  // Recorrer y modificar cada página para incluir el número de página
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.addImage(imgData, "PNG", 40, -15, 60, 60);
    // Establece la fuente a "Helvetica"
    doc.setFont("ArialNovaCond", "normal");
    // Establece el tamaño de la fuente
    doc.setFontSize(10); // Tamaño de fuente de 16
    // Establece el color de texto en naranja específico
    doc.setTextColor(249, 95, 33); // Naranja específico
    // Agrega texto al documento
    doc.text("Cotización", 102, 15);
    doc.text("Datos Generales y Tabla de Amortización", 102, 19);
    doc.setFontSize(8);
    doc.text("Folio: " + numeroCotizacion, 159, 23, { align: "right" });
    doc.setFont("ArialNovaCondBold", "bold");
    doc.setFontSize(7);
    doc.setTextColor(0, 0, 0);
    doc.text(`Página ${i} de ${totalPages}`, 105, 273);
  }
  const pdfBase64 = doc.output('datauristring');
  return pdfBase64;
}
// Función para calcular el pago mensual
function calcularPagoMensual(tasaAnual, numeroPagos, valorActual, calculoOpcionCompra) {
  // Convertir la tasa anual a mensual
  const tasaMensual = tasaAnual / 12;

  // Si la tasa de interés es cero, el pago es simplemente el valor del préstamo dividido por el número de pagos
  if (tasaMensual === 0) {
    return valorActual / numeroPagos;
  }

  // Calcular el pago mensual usando la fórmula para tasas de interés no cero
  //console.log(tasaMensual, valorActual, calculoOpcionCompra, numeroPagos);
  const pagoMensual = -(
    tasaMensual * (
      -valorActual +
      (calculoOpcionCompra / ((1 + tasaMensual) ** numeroPagos))
    )
  ) / (1 - ((1 + tasaMensual) ** -numeroPagos));


  return pagoMensual;
}

//Método que envía los datos a la API Monday.com
async function sendMondayApiRequest(query, version) {
  try {
    const response = await axios.post('https://api.monday.com/v2', {
      query: query
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjM4MDk5MjcyMiwiYWFpIjoxMSwidWlkIjo0MDY5NzEwMSwiaWFkIjoiMjAyNC0wNy0wNVQyMTowMjozMi4wMDBaIiwicGVyIjoibWU6d3JpdGUiLCJhY3RpZCI6MTA5Mjg0OTUsInJnbiI6InVzZTEifQ.55PVw2YfNZ7d7DUgqfEOl4vLHlh3MU5QGnwReMl-NpQ',
        'API-Version': version
      },
      timeout: 10000, // Establecer un tiempo de espera de 5 segundos
      family: 4 // Forzar el uso de IPv4
    });
    return response;
  } catch (error) {
    console.error('Error en la solicitud a Monday.com:', error);
    console.error('Detalles del error:', error.response ? error.response.data : error.message);
    throw error;
  }
}

//Este método de Express permite escuchar el puerto en el que se ejecuta la aplicación.
app.listen(port, () => {
  console.log(`Listen on port ${port}`);
});
