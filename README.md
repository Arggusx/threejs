# Garagem 3D — Homem-Aranha, Optimus Prime, Ferrari 458, Porsche 911 GT3 R e Audi RS6

Projeto em [three.js](https://threejs.org) baseado no exemplo
[`webgl_materials_car`](https://github.com/mrdoob/three.js/blob/master/examples/webgl_materials_car.html).
Você controla o Homem-Aranha a pé e pode entrar em qualquer um dos carros para dirigir. Tudo acontece num
mundo de doces no estilo Sugar Rush: carros, Homem-Aranha e Optimus começam na praça quadriculada de largada,
em cima da pista (a ~30 m do gramado), e dá para dirigir/andar por toda a pista — subidas, descidas, pontes —
ou descer a rampa até o gramado, onde ficam a garagem e um slalom de cones.

Modelos:

- **Ferrari 458 Italia** de [vicent091036](https://sketchfab.com/models/57bf6cc56931426e87494f554df1dab6),
- **Porsche 992 GT3 R** de [MattDoesBlender](https://sketchfab.com/3d-models/porsche-992-gt3-r-03ea07f7972648aa9350853b2a1a942a),
- **Audi RS6 Avant 2020** de [ChoochooLi Models](https://sketchfab.com/3d-models/audi-0b9f29e1b7a6404fa4bc2cb59c536b21),
  licença [CC BY-NC-SA 4.0](http://creativecommons.org/licenses/by-nc-sa/4.0/) (uso não comercial)
- **The Amazing Spider-Man 2 Spider-Man** de [fredbear1211](https://sketchfab.com/3d-models/the-amazing-spider-man-2-spider-man-def66432d0434cceb2e2ad260a94b5af),
  licença [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/)
- **Bumblebee - Optimus Prime Transform Animation** de [DIO](https://sketchfab.com/dioiiiii2)
  ([modelo](https://sketchfab.com/3d-models/bumblebee-optimus-prime-transform-animation-35f9cb09b1b248c7bd6b12912ac8cd3a)),
  licença [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/)
- **Map_tgsd** (cenário de doces) de [amogusstrikesback2](https://sketchfab.com/amogusstrikesback2)
  ([modelo](https://sketchfab.com/3d-models/map-tgsd-6cf96205665d48b681aab3b129aa9a79)),
  licença [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/)

## Como rodar

```bash
npm install
npm run dev
```

Abra http://localhost:5173. Para gerar a versão de produção: `npm run build` (saída em `dist/`).

## Controles

| Tecla | Ação |
| --- | --- |
| `W` / `↑` | Andar / acelerar |
| `S` / `↓` | Andar para trás / frear / ré |
| `A` `D` / `←` `→` | Andar para os lados (câmera livre) / virar |
| `Shift` | Correr (a pé) |
| `Espaço` | Pular (a pé) / freio de mão |
| `F` | Entrar no carro mais próximo / sair do carro |
| `B` | Dançar (a pé) — a dança do meme do Homem-Aranha, com música; qualquer movimento interrompe |
| `V` | "Vai, teia!" (a pé) — dispara uma teia do pulso, com a fala |
| `Q` / `E` | Abrir/fechar porta esquerda/direita (carro parado) |
| `G` | Ir para a garagem / sair da garagem (piloto automático); a pé, abre/fecha o portão |
| `L` | Faróis |
| `H` | Pisca-alerta |
| `C` | Alternar câmera (livre, perseguição, cockpit) |
| `T` | Trocar de carro (dirigindo) |
| `R` | Transformar o Optimus (caminhão ↔ robô) |

A pé, chegue perto de um carro e aperte `F`: o Homem-Aranha abre a porta do motorista e entra. Com o carro
parado, `F` de novo faz ele sair. Também dá para escolher o carro **clicando nele no mundo** (ou na etiqueta
com o nome que aparece sobre ele) ou pelo seletor **Controle** no painel. O carro precisa estar parado para trocar.

**Optimus Prime:** selecione-o em **Controle** no painel. Ele começa como caminhão e é dirigido com
`W` `A` `S` `D`; parado, `R` faz a transformação (a animação original do modelo) e, quando ela termina,
toca "Autobots, vamos rodar!". Como robô ele anda como uma pessoa (`Shift` corre) — a caminhada é feita
girando os ossos do rig Biped em `Optimus.js`. `R` de novo volta para caminhão. Ele não colide com os carros
nem com o Homem-Aranha (só com o cenário e a garagem). Para voltar, escolha outro personagem/carro no painel.

Na câmera livre o Homem-Aranha anda na direção da câmera; nas câmeras de perseguição e primeira pessoa,
`A`/`D` giram o personagem. O modelo não tem animações: o ciclo de caminhada/corrida/pulo é feito girando os
ossos do rig (Mixamo) via código em `Character.js`.

Em **Gráficos** (painel) dá para escolher a qualidade: **Baixo** (sem sombras, resolução 1:1), **Médio**
(sombra menor, vidro sem refração) ou **Alto**. Na primeira visita o jogo começa no Alto, mede o tempo
dos quadros e desce de nível sozinho se ficar abaixo de ~25 fps; uma escolha manual fica salva no navegador.

### Cenário e organização

O mapa (`world/sugarRush.js`) é escalado 50× para a pista ficar com ~11 m de largura, e o gramado fica na
altura 0. Os materiais do mapa eram sem iluminação; viraram Lambert com parte da cor "emissiva", para manter
as cores e ainda receber as sombras dos carros e personagens. `world/ramp.js` cria a rampa de doce que liga a
praça de largada ao gramado (160 m, ~11°).

**Física com relevo** (`world/terrain.js`): ao carregar, as malhas viram um mapa de alturas em grade de 1 m.
- **Chão** são as malhas da pista (`road_*`, incluindo a praça) e o tabuleiro da rampa; cada célula guarda
  até 4 superfícies, então dá para passar por baixo de pontes (como o arco-íris sobre a praça). Fora delas, o
  chão é o gramado.
- **Obstáculos** são o resto (ilhas, doces, guarda-corpos): cada célula marca em quais faixas de 0,5 m de
  altura há geometria.
- Cada um consulta a superfície mais alta que alcança a partir da altura em que está: degraus acima do
  limite (carro 1,2 m, Homem-Aranha 0,6 m) ou obstáculos na altura do corpo bloqueiam, e quedas maiores que
  ~1,5 m são beirada — ninguém cai da pista.
- Carros e o Optimus caminhão inclinam conforme o relevo (frente/trás e lados); o Homem-Aranha pula e
  cai com gravidade a partir do chão onde está.
- A câmera de perseguição usa o mesmo mapa para não entrar nas paredes.

A garagem fica no gramado, no pé da rampa; "Ir para a garagem" só funciona chegando perto dela (o piloto
automático não desvia do relevo).

Todas as posições ficam em `world/layout.js`: vagas dos carros, lugar de cada personagem, garagem, Optimus e
slalom de cones. `world/paddock.js` pinta o pátio no chão a partir desse layout (vagas com o nome, faixa
quadriculada e círculos dos personagens). **A Vanellope e o carro dela já têm lugar reservado** (vaga e
círculo em verde-água): quando forem adicionados, basta usar as entradas `vanellope` e `vanellope-kart`.

Para o navegador carregar e desenhar menos:
- Os carros mostram as peças pequenas só a menos de 60 m da câmera, e só o carro perto da câmera (14 m) usa
  o vidro com refração (ele obriga a desenhar a cena inteira de novo).
- A geometria do Porsche e do Audi foi simplificada com meshoptimizer (489 mil → 236 mil e 250 mil → 168 mil
  triângulos), sem diferença visível de perto. A Ferrari ficou como estava: a carroceria é uma peça só e quase
  não reduz sem estragar.
- Além disso: os `.glb` usam geometria Draco e texturas WebP (no máximo
2048 px nos carros e no Homem-Aranha, 1024 px no Optimus), e ao carregar `utils/merge.js` junta as peças
que se movem juntas e têm o mesmo material. No Optimus, as ~260 peças animadas viram uma malha com
esqueleto por material (~14 chamadas de desenho em vez de ~260), sem perder a animação de transformação. O mapa passa de 11 MB
para 1,8 MB e de 60 para 16 malhas.

O painel lateral permite mudar **cor e acabamento da pintura**, **acabamento das rodas**,
**cor das pinças de freio**, **aerofólio** (só na Ferrari — o GT3 R já tem asa), **tom dos vidros**,
**cor do couro** e **altura da suspensão**. Cada carro guarda as suas próprias escolhas.

## Estrutura

```
src/
  main.js               cena, câmeras, entrada, painel, seleção de carro e sequências de garagem
  style.css
  character/
    Character.js        personagem a pé: movimento, colisão, pulo e animação procedural dos ossos
    spiderman.js        dados do modelo do Homem-Aranha
    dance.js            coreografia do meme (quadros-chave copiados do vídeo de referência)
    vaiTeia.js          animação do "vai, teia!" (disparo de teia sincronizado com a fala)
    Optimus.js          Optimus Prime: direção como caminhão, transformação e caminhada como robô
    routine.js          interpolação das poses-chave das coreografias
  car/
    Car.js              carro genérico: física (modelo de bicicleta), portas, luzes e peças
    models/
      index.js          lista de carros disponíveis
      ferrari.js        o que é específico da Ferrari (nomes das peças, pivôs, medidas)
      porsche.js        o que é específico do Porsche
      audi.js           o que é específico do Audi
  world/
    garage.js           garagem com portão basculante, iluminação interna e colisores
    sugarRush.js        cenário de doces: escala, materiais e grade de obstáculos
    terrain.js          mapa de alturas em camadas + obstáculos por altura (física com relevo)
    ramp.js             rampa da praça de largada até o gramado
    layout.js           onde fica cada coisa (vagas, personagens, garagem, cones), com a Vanellope reservada
    paddock.js          pátio pintado no chão a partir do layout
  utils/
    tween.js            mini sistema de animações
    merge.js            junta malhas para reduzir chamadas de desenho
public/                 servido como está pelo Vite
  models/ferrari/       ferrari.glb
  models/porsche/       porsche_992_gt3_r.glb
  models/spiderman/     spiderman.glb
  models/optimus/       optimus.glb
  models/map/           sugar_rush.glb (cenário)
  audio/                música da dança, a fala "vai, teia!" e "Autobots, vamos rodar!"
  textures/             HDR do ambiente e sombra dos carros
  draco/                decodificador Draco
assets/source/          arquivos originais baixados (não são usados pelo app)
```

### Adicionando outro carro

Crie `src/car/models/<carro>.js` no mesmo formato de `porsche.js` (URL do `.glb`, medidas, posição
dos olhos no cockpit e uma função `build` que monta rodas, volante, portas e materiais), registre-o
em `models/index.js` e defina a vaga dele em `LAYOUT.cars` (`world/layout.js`).

### Como as portas funcionam

- **Ferrari:** o modelo não tem portas separadas — a carroceria é uma única malha. Ao carregar,
  `ferrari.js` recorta os triângulos que estão dentro de `DOOR_REGION` e os prende a um pivô na
  dobradiça de cada lado, que é então animado.
- **Porsche:** as portas já são peças separadas (`DOOR_L`/`DOOR_R`); elas só são presas a um pivô
  posicionado na dobradiça do próprio modelo.
