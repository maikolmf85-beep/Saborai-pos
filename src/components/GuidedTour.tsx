import { useEffect } from 'react';
import { driver } from 'driver.js';
import 'driver.js/dist/driver.css';

export function GuidedTour() {
  useEffect(() => {
    const tourSeen = localStorage.getItem('saborai_tour_seen');
    if (tourSeen) return;

    // Ensure the DOM is fully loaded before starting the tour
    setTimeout(() => {
      const driverObj = driver({
        showProgress: true,
        animate: true,
        nextBtnText: 'Siguiente',
        prevBtnText: 'Atrás',
        doneBtnText: 'Comenzar a usar',
        progressText: 'Paso {{current}} de {{total}}',
        steps: [
          {
            popover: {
              title: '¡Bienvenido a Saborai POS!',
              description: 'El primer sistema con IA nativa diseñado para Costa Rica. Vamos a dar un rápido recorrido por las funciones principales.',
              side: "bottom",
              align: 'center'
            }
          },
          {
            element: 'aside',
            popover: {
              title: 'Navegación Principal',
              description: 'Desde aquí puedes cambiar entre las diferentes vistas: Mesas, KDS (Cocina), Caja y Reportes.',
              side: "right",
              align: 'start'
            }
          },
          {
            element: '#nav-shift-btn',
            popover: {
              title: 'Turno de Caja',
              description: 'Abre o cierra tu turno de caja, haz retiros, y saca tus Reportes Z. Es vital para poder empezar a tomar pedidos.',
              side: "right",
              align: 'start'
            }
          },
          {
            element: '#nav-copilot-btn',
            popover: {
              title: 'Saborai Copilot (IA)',
              description: 'Tu asistente virtual. Puedes preguntarle cualquier cosa, desde ventas del día hasta sugerencias de maridajes y ayuda con Hacienda.',
              side: "right",
              align: 'end'
            }
          },
          {
            element: '.tour-table-map',
            popover: {
              title: 'Mapa de Mesas',
              description: 'Toca cualquier mesa para abrir una comanda. Los colores te indicarán si la mesa está libre, ocupada o esperando cuenta.',
              side: "top",
              align: 'start'
            }
          }
        ],
        onDestroyStarted: () => {
          if (!driverObj.hasNextStep() || confirm("¿Estás seguro que deseas saltar el tutorial?")) {
            driverObj.destroy();
            localStorage.setItem('saborai_tour_seen', 'true');
          }
        },
      });

      driverObj.drive();
    }, 1500); // Wait 1.5s to ensure everything renders (like tables, auth, etc.)
  }, []);

  return null;
}
