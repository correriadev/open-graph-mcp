# Sombras de Alkhor — ideia solta

jogo estilo tibia, top-down pixelado, sandbox. to pensando numa ilha pequena
tipo 5 regioes conectadas por pontes/passagens estreitas. baixar o zoom pra
sentir claustrofobia.

a ideia central é: o véu entre o mundo material (Alkhor) e o Umbral enfraqueceu
e criaturas do esquecimento tão atravessando. o player decide se sela a fenda,
drena o poder dela, ou funde os dois planos. três finais, depende de escolha
não de level.

tom: fantasia sombria low-magic. sem heróis escolhidos, sem deuses
onipresentes. todo npc pode tá certo, errado ou mentindo. pegar carona do
darksouls na narrativa ambiental — item descriptions, diários espalhados, 
máximo de diálogo direto.

## o que quero testar

- sensação de estar num mundo vivo, não um lobby de quests
- progressão orgânica (skill sobe com uso, sem level numerico)
- consequência real de escolha (cada ato final é irreversível)
- medo genuíno de explorar a noite ou áreas não mapeadas

## mapa (na cabeça)

ilha pequena. algo assim:

vila inicial no centro -> pântano a leste -> ruínas -> templo do umbral
floresta negra ao norte -> caverna
montanhas a oeste, porto ao sul

5 biomas, 1-2 dungeons cada. viagem rápida só entre porto e vila (balsa),
resto é a pé. quero que o player sinta distância.

## vocacoes?

gosto da ideia de NÃO ter classe fixa. player treina tudo, o que limita é tempo.
espada, machado, arco, 4 escolas mágicas (fogo/gelo/terra/umbral). se quer
ser puro guerreiro, só não treina magia. se quer ser mago híbrido com shielding,
pode. quero testar se isso quebra o balanceamento ou se a liberdade compensa.

atributos sobem com uso igual no tibia: força, destreza, vigor, intelecto, fé.

## progressão sem level

marcos por skill tier:
- T1 iniciante ~2h
- T2 capaz ~10h  
- T3 experiente ~40h
- T4 mestre ~120h

pode parar e voltar, perde nada. morre? perde 10% skill current e volta pra
vila (pra morte bater mais forte no emocional do que no mechanic).

## NPC principal

o velho Orlik. antigo mago que atravessou o Umbral e voltou "meio quebrado".
fala em fragmentos, às vezes contradiz o que disse antes. vai dando pistas
ao longo do tempo conforme trust do player sobe. morre no final 2（drena o
umbral) dizendo que era a única forma dele descansar.

## boss final — o Echo

criatura do umbral que clona o player. tá ligado: cada clone morre com o
dano que o player MENOS usa. player de espada precisa derrubar o clone
de magia.braço direito de espada morre com magia, braço esquerdo de magia
morre com espada. centro É o player real — tem que se reconhecer.

## o que ainda não sei

- se faço respawn de mob por tick ou por limpeza de área
- se salvo ties do mundo globalmente (estado do umbral afetando todos)
- como impedir speedhack sem chato
- quantos players simultaneos quero suportar no protótipo
- se vale sistema de dia/noite com ciclo de 30min ou 2h
- música: quero algo minimalista, violão destemplado + vento. talvez sem
  música de combate.

## stack (provavel)

server em Go, client em canvas 2D puro (já tenho o mcp-web de referencia).
sprites 32x32, tileset 16x16. persistência SQLite pra player data, JSONL
pro event log (importante pra auditoria.depois penso em como usar isso).

## missões que quero que existam (não em ordem)

- levar poções pro guarda da ponte (tutorial disfarçado)
- achar diário do Orlik no pântano
- puzzle das 3 estátuas nas ruínas (ordem errada spawna mini-boss)
- torre do necromante: dá pra passar sem combate se souber a senha (senha
  espalhada em 4 livros pelo mapa)
- masmorra do porto: uma criatura nova spawna por dia, repetível
- eclipse semanalclipse abrir a fenda e spawnar boss mundial

## inspirações que quero evitar copiar

- skyrim (quests com marcador, muita mão na cara)
- wow (gear grind, treadmill de item)
- minecraft (sem objetivo, sem tom)

## o que DEFINITIVAMENTE quero

- morte dói
- noite assusta
- silence é mecânica (áreas sem som, sem música, sem indicador de HP de mob)
- cada escolha final é irreversível (escolheu um altar, aquele final é seu)
- o mapa não existe como minimapa. player desenha ou memoriza.

---

*arquivo é rascunho solta mesmo. sem ordem cronológica, sem formato definido.
conforme as ideias vão se firmando vou separando em arquivos por sistema.*