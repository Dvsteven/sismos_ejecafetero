// El servidor del SGC (archive.sgc.gov.co) no envía el certificado
// intermedio de su cadena TLS. Los navegadores lo descargan solos, pero
// Node.js no, y fetch() falla con "unable to get local issuer certificate".
// Por eso aquí se incluye ese intermedio (Verokey Verified Business G2,
// firmado por DigiCert Global Root G2, vence en 2032) junto a las raíces
// normales de Node. Origen: http://cacerts.digicert.com/VerokeyVerifiedBusinessG2.crt
import https from 'node:https';
import tls from 'node:tls';

const INTERMEDIO_SGC = `
-----BEGIN CERTIFICATE-----
MIIFNTCCBB2gAwIBAgIQAqN9dVvbCvNwvMrBdxUWujANBgkqhkiG9w0BAQwFADBh
MQswCQYDVQQGEwJVUzEVMBMGA1UEChMMRGlnaUNlcnQgSW5jMRkwFwYDVQQLExB3
d3cuZGlnaWNlcnQuY29tMSAwHgYDVQQDExdEaWdpQ2VydCBHbG9iYWwgUm9vdCBH
MjAeFw0yMjAzMTcwMDAwMDBaFw0zMjAzMTYyMzU5NTlaMEYxCzAJBgNVBAYTAkFV
MRAwDgYDVQQKEwdWZXJva2V5MSUwIwYDVQQDExxWZXJva2V5IFZlcmlmaWVkIEJ1
c2luZXNzIEcyMIIBojANBgkqhkiG9w0BAQEFAAOCAY8AMIIBigKCAYEAoc1NaPMO
OH2LT7qbByD/qOLuCsGzrsg0BJIYk/Tk3sQnzLSL3TvW9HIhohERHD578kFRe7FT
7LTK36couuVLxcH+psulmtu2is6sd0xzZr8b8MvJ2yCom9vTinQHLQLr8pyfEVFB
nOt21igjzNfwDCY2zGPmOznPHNGY2fbmODgbodpvmpcNYYMJWwsS0G/T3PCDpgHU
r7uYrKnpUI6bcfMLoxMhlK4FBS5lds3TfnMlrP5B+Ws8l1toeagnWYm/bzIS0Yi3
NxNh17ghpC++lqPEmeiVQGp4KtBwc2kOkXNlmKi+cu2rtCo0BtgKH5cjCQAlnAWF
eHX3rLwc6STYd+w15BnNLXbde3SLwsT5v5AkWMcCFjE9MwznxSY2LHKgZvj/CXKA
F0aPt7MXI6E0i3OIC1spg4SBU+N+XUgvMjgWyt9392d7xDWY8cvX8fQOOuKX8oh2
Gt5DGNW5lwlurzIkMSUOWWbWf6MnRvO4doywRzWqDZHtohiv1j0oyrH9AgMBAAGj
ggGCMIIBfjASBgNVHRMBAf8ECDAGAQH/AgEAMB0GA1UdDgQWBBT0Mzw6yJtwGnCk
lmTmv0JS1f7/0jAfBgNVHSMEGDAWgBROIlQgGJXm427mD/r6uRLtBhePOTAOBgNV
HQ8BAf8EBAMCAYYwHQYDVR0lBBYwFAYIKwYBBQUHAwEGCCsGAQUFBwMCMHYGCCsG
AQUFBwEBBGowaDAkBggrBgEFBQcwAYYYaHR0cDovL29jc3AuZGlnaWNlcnQuY29t
MEAGCCsGAQUFBzAChjRodHRwOi8vY2FjZXJ0cy5kaWdpY2VydC5jb20vRGlnaUNl
cnRHbG9iYWxSb290RzIuY3J0MEIGA1UdHwQ7MDkwN6A1oDOGMWh0dHA6Ly9jcmwz
LmRpZ2ljZXJ0LmNvbS9EaWdpQ2VydEdsb2JhbFJvb3RHMi5jcmwwPQYDVR0gBDYw
NDALBglghkgBhv1sAgEwBwYFZ4EMAQEwCAYGZ4EMAQIBMAgGBmeBDAECAjAIBgZn
gQwBAgMwDQYJKoZIhvcNAQEMBQADggEBAJBQbb8KlJII+B3nciahlhR0sXKeWd7U
ggM8XCOr0Mq3v9LJl7uPKsB0ccpfRwpuNOMdpP7y6YKGjtCSgT4g/KOZZvGTDd/E
FJilO/zH4+450jplHk3pc239017A4iOUsxdUBx/mVpi62eYgrzKHjlMBr2sUgqO5
D3X12njcJx3TUzFkP34Z0pHoT13jCR4YdZ4D1RC6fxm8AbS7SLoMBtyZC8tVHCq5
HloWYSOMEDbhghLQNAvoUZud1NfkZjQI/ykTVhbEhooN19fGQbshNT7lGtUxg+di
UAQhZL22EphGMPTyoC9w8OlcTr9x/33laOY1Dh3CQroSkJXBMPSN7tY=
-----END CERTIFICATE-----
`;

const agente = new https.Agent({ ca: [...tls.rootCertificates, INTERMEDIO_SGC], keepAlive: false });

/** GET de JSON con la cadena TLS completa del SGC. Sigue redirecciones. */
export function pedirJsonSGC(url, headers = {}, ms = 15_000, saltos = 3) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers, agent: agente, timeout: ms }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && saltos > 0) {
        res.resume();
        resolve(pedirJsonSGC(new URL(res.headers.location, url).href, headers, ms, saltos - 1));
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`respondió ${res.statusCode}`));
        return;
      }
      let cuerpo = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (cuerpo += c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(cuerpo));
        } catch {
          reject(new Error('respuesta no es JSON'));
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('tiempo de espera agotado')));
    req.on('error', reject);
  });
}
