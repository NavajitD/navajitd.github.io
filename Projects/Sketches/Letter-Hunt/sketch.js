// ============================================
// LETTER HUNT - p5.js Sketch
// ============================================
let currentState = 1;
let selectedFruit = null; // "bananas" or "pineapples"
// Image paths - replace with your actual images
let images = {};

let imageFiles = {
  1: "1.jpeg",
  2: "2.jpeg",
  3: "3.jpeg",
  4: "4.jpeg"
};

// Define hotspots for each state - EDIT THESE COORDINATES
const hotspots = {
  1: { letter: "P", x: 194, y: 7, width: 140, height: 162 },
  2: { letter: "B", x: 194, y: 74, width: 52, height: 56 },
  3: [
    { letter: "B", x: 151, y: 211, width: 25, height: 30, fruit: "bananas" },
    { letter: "P", x: 0, y: 197, width: 35, height: 35, fruit: "pineapples" }
  ]
};

// Highlight box positions on final image - EDIT THESE
const fruitHighlights = {
  bananas: { x: 231, y: 25, width: 161, height: 183 },
  pineapples: { x: 76, y: 120, width: 68, height: 165 }
};

// Overlay messages
const overlayText = {
  1: "Find 'the' letter to go on",
  2: "Find the next letter",
  3: "You're close!",
  4: "" // Set dynamically based on fruit
};

function preload() {
  for (let i = 1; i <= 4; i++) {
    images[i] = loadImage(imageFiles[i]);
  }
  console.log(images.length)
}

function setup() {
  createCanvas(500, 500);
}

function draw() {
  background(30);
  
  // Draw current image
  image(images[currentState], 0, 0, width, height);
  
  // Draw hotspot highlight on hover (before final state)
  if (currentState !== 4) {
    let spots = currentState === 3 ? hotspots[3] : [hotspots[currentState]];
    for (let spot of spots) {
      if (isMouseOver(spot)) {
        let pulse = sin(frameCount * 0.15) * 30 + 100;
        stroke(255, 220, 50, pulse);
        strokeWeight(1);
        fill(255, 220, 50, 40);
        rect(spot.x, spot.y, spot.width, spot.height, 5);
      }
    }
  }
  
  // Draw highlight box on final state
  if (currentState === 4 && selectedFruit) {
    let hl = fruitHighlights[selectedFruit];
    stroke(255, 220, 50);
    strokeWeight(2);
    fill(255, 150, 50, 50);
    rect(hl.x, hl.y, hl.width, hl.height, 10);
    
    // Pulsing glow
    let pulse = sin(frameCount * 0.1) * 30 + 80;
    stroke(255, 220, 50, pulse);
    strokeWeight(12);
    rect(hl.x, hl.y, hl.width, hl.height, 10);
  }
  
  // Draw overlay text
  drawOverlay();
}

function drawOverlay() {
  // Semi-transparent bar at top
  noStroke();
  fill(50, 50, 50, 180);
  rect(0, 400, width, 60);
  
  // Text
  fill(255);
  textAlign(CENTER, CENTER);
  textSize(25);
  
  let msg = currentState === 4 ? (selectedFruit === "bananas" ? "You got Bananas!" : "You got Pine-apples!")
    : overlayText[currentState];
  
  text(msg, width / 2, 430);
}

function mousePressed() {
  if (currentState === 4) return; // End state
  
  let spots = currentState === 3 ? hotspots[3] : [hotspots[currentState]];
  
  for (let spot of spots) {
    if (isMouseOver(spot)) {
      if (currentState === 3) {
        selectedFruit = spot.fruit;
      }
      currentState++;
      break;
    }
  }
}

function isMouseOver(spot) {
  return mouseX >= spot.x && mouseX <= spot.x + spot.width &&
         mouseY >= spot.y && mouseY <= spot.y + spot.height;
}
  
// Press R to restart
function keyPressed() {
  if (key === 'r' || key === 'R') {
    currentState = 1;
    selectedFruit = null;
  }
}
