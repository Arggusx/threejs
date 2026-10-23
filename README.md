# Ferrari 458 — Garagem 3D

Projeto em [three.js](https://threejs.org) baseado no exemplo
[`webgl_materials_car`](https://github.com/mrdoob/three.js/blob/master/examples/webgl_materials_car.html)
(modelo Ferrari 458 Italia de [vicent091036](https://sketchfab.com/models/57bf6cc56931426e87494f554df1dab6)).

## Como rodar

```bash
npm install
npm run dev
```

Abra http://localhost:5173. Para gerar a versão de produção: `npm run build` (saída em `dist/`).

## Controles

| Tecla | Ação |
| --- | --- |
| `W` / `↑` | Acelerar |
| `S` / `↓` | Frear / ré |
| `A` `D` / `←` `→` | Virar |
| `Espaço` | Freio de mão |
| `Q` / `E` | Abrir/fechar porta esquerda/direita (carro parado) |
| `G` | Ir para a garagem / sair da garagem (piloto automático) |
| `L` | Faróis |
| `H` | Pisca-alerta |
| `C` | Alternar câmera (livre, perseguição, cockpit) |

O painel lateral também permite trocar **cor e acabamento da pintura**, **acabamento das rodas**,
**cor das pinças de freio**, **aerofólio** (lip ou asa GT), **tom dos vidros**, **cor do couro** e
**altura da suspensão**.

## Estrutura

- `src/main.js` — cena, câmeras, entrada do teclado, painel e as sequências de garagem
- `src/car.js` — carregamento do modelo, física simples (modelo de bicicleta), portas, luzes e peças
- `src/garage.js` — garagem com portão basculante, iluminação interna e colisores
- `src/tween.js` — mini sistema de animações
- `public/` — modelo `.glb`, sombra, HDR do ambiente e decodificador Draco

### Como as portas funcionam

O modelo original não tem portas separadas: a carroceria é uma única malha. Ao carregar, `car.js`
recorta os triângulos que estão dentro de `DOOR_REGION` (em todas as malhas da carroceria e do
interior) e os prende a um pivô na dobradiça de cada lado, que é então animado.
