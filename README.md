# Garagem 3D — Ferrari 458 e Porsche 911 GT3 R

Projeto em [three.js](https://threejs.org) baseado no exemplo
[`webgl_materials_car`](https://github.com/mrdoob/three.js/blob/master/examples/webgl_materials_car.html).
Os dois carros ficam no mundo; você dirige um de cada vez e pode trocar a qualquer momento.

Modelos:

- **Ferrari 458 Italia** de [vicent091036](https://sketchfab.com/models/57bf6cc56931426e87494f554df1dab6),
- **Porsche 992 GT3 R** de [MattDoesBlender](https://sketchfab.com/3d-models/porsche-992-gt3-r-03ea07f7972648aa9350853b2a1a942a),
- **Audi RS6 Avant 2020** de [ChoochooLi Models](https://sketchfab.com/3d-models/audi-0b9f29e1b7a6404fa4bc2cb59c536b21),
  licença [CC BY-NC-SA 4.0](http://creativecommons.org/licenses/by-nc-sa/4.0/) (uso não comercial)

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
| `T` | Trocar de carro |

Também dá para trocar de carro **clicando nele no mundo** (ou na etiqueta com o nome que aparece sobre
ele) ou pelo seletor **Carro** no painel. O carro precisa estar parado para trocar.

O painel lateral permite mudar **cor e acabamento da pintura**, **acabamento das rodas**,
**cor das pinças de freio**, **aerofólio** (só na Ferrari — o GT3 R já tem asa), **tom dos vidros**,
**cor do couro** e **altura da suspensão**. Cada carro guarda as suas próprias escolhas.

## Estrutura

```
src/
  main.js               cena, câmeras, entrada, painel, seleção de carro e sequências de garagem
  style.css
  car/
    Car.js              carro genérico: física (modelo de bicicleta), portas, luzes e peças
    models/
      index.js          lista de carros disponíveis
      ferrari.js        o que é específico da Ferrari (nomes das peças, pivôs, medidas)
      porsche.js        o que é específico do Porsche
      audi.js           o que é específico do Audi
  world/
    garage.js           garagem com portão basculante, iluminação interna e colisores
  utils/
    tween.js            mini sistema de animações
public/                 servido como está pelo Vite
  models/ferrari/       ferrari.glb
  models/porsche/       porsche_992_gt3_r.glb
  textures/             HDR do ambiente e sombra dos carros
  draco/                decodificador Draco
assets/source/          arquivos originais baixados (não são usados pelo app)
```

### Adicionando outro carro

Crie `src/car/models/<carro>.js` no mesmo formato de `porsche.js` (URL do `.glb`, medidas, posição
dos olhos no cockpit e uma função `build` que monta rodas, volante, portas e materiais), registre-o
em `models/index.js` e defina onde ele começa em `START` no `main.js`.

### Como as portas funcionam

- **Ferrari:** o modelo não tem portas separadas — a carroceria é uma única malha. Ao carregar,
  `ferrari.js` recorta os triângulos que estão dentro de `DOOR_REGION` e os prende a um pivô na
  dobradiça de cada lado, que é então animado.
- **Porsche:** as portas já são peças separadas (`DOOR_L`/`DOOR_R`); elas só são presas a um pivô
  posicionado na dobradiça do próprio modelo.
