---
layout: base.njk
title: Asterismo
permalink: "/asterismo/"
isProject: true
description: "Asterismo é uma ferramenta conceitual e performance participativa para criar sentido coletivamente através de um céu estrelado."
image: "/project-files/asterismo/asterismo-06.webp"
custom_css: "asterismo.css"
priority: 0.6
---

<main class="project">
  <div class="project-container">
    <h1 class="project-title">Asterismo</h1>
    <p class="project-team"><b>Lu Immich </b>(Design e Idealização)</p>
<div class="project-description">
      <p><b>ÁSTER (estrela) + ISMO (ação)</b><br>Asterismo é uma ferramenta conceitual para criar sentido coletivamente. Sua proposta central é contra-intuitiva, em vez de impor sentido ao que emerge, deve-se deixar o sentido aparecer na inter(ação). O terreno desta ação é um céu estrelado. Sobre ele as participantes conectam estrelas traçando linhas em um gesto contínuo.</p>
      <p>O que emerge dos traços é uma configuração que não teria surgido de nenhuma intenção isolada. O sentido desta configuração encontra-se suspenso. É nesse estado de suspensão que as participantes agem coletivamente atribuindo sentido ao que emergiu. Ao final, o Céu Noturno é um registro único do que aconteceu naquele encontro específico.</p>
    </div>
    <div class="project-desc-container">
      <p class="project-year"><b>2026</b></p>
    </div>
  </div>
</main>

<section class="project-img-container">
  {% image "project-files/asterismo/asterismo-06.webp", "Manual", "project-img" %}
  {% image "project-files/asterismo/asterismo-02.webp", "Ceu estrelado", "project-img" %}
  {% image "project-files/asterismo/asterismo-03.webp", "Cronometro", "project-img" %}

  <div class="constellation-panel-container">
    <h3>Vamos?</h3>
    <div class="canvas-wrapper">
      <canvas id="skyCanvas"></canvas>
    </div>  
    <div class="constellation-panel-description">
        <a href="/projects/asterismo/asterismo-instrucoes.pdf" download>Instruções</a>
        <a id="btn-open-timer">Cronômetro</a>
        <a id="btn-download">Baixe o tabuleiro</a>
        <a id="btn-generate">Embaralhar o tabuleiro</a>
    </div>
  </div>
</section>

<!-- O Modal do Timer -->
<div id="timer-modal" class="modal-overlay hidden">
  <div class="modal-content">
    <button id="btn-close-timer" class="btn-close">&times;</button>
    <div id="dot-grid" class="dot-grid"></div>
    <div class="timer-controls">
      <button id="btn-time-minus" class="time-adjust">-</button>
      <span id="time-display">02:00</span>
      <button id="btn-time-plus" class="time-adjust">+</button>
    </div>
    <button id="btn-start-timer" class="btn-start">COMEÇAR</button>
  </div>
</div>

<!-- Page-Specific Scripts -->
<script src="/js/jspdf.umd.min.js"></script>
<script src="/js/asterism.js"></script>
