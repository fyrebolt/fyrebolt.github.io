import { useState, useEffect } from 'react';

interface DeviceOrientation {
  alpha: number; // z-axis rotation [0, 360)
  beta: number;  // x-axis rotation [-180, 180)
  gamma: number; // y-axis rotation [-90, 90)
  supported: boolean;
}

export function useDeviceOrientation(): DeviceOrientation {
  const [orientation, setOrientation] = useState<DeviceOrientation>({
    alpha: 0,
    beta: 0,
    gamma: 0,
    supported: false,
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleOrientation = (event: DeviceOrientationEvent) => {
      setOrientation({
        alpha: event.alpha || 0,
        beta: event.beta || 0,
        gamma: event.gamma || 0,
        supported: true,
      });
    };

    // iOS 13+ requires permission
    if (
      typeof DeviceOrientationEvent !== 'undefined' &&
      'requestPermission' in DeviceOrientationEvent &&
      typeof (DeviceOrientationEvent as unknown as { requestPermission: () => Promise<string> }).requestPermission === 'function'
    ) {
      // Permission will be requested on user interaction (touch start)
      const requestOnInteraction = async () => {
        try {
          const permission = await (DeviceOrientationEvent as unknown as { requestPermission: () => Promise<string> }).requestPermission();
          if (permission === 'granted') {
            window.addEventListener('deviceorientation', handleOrientation);
          }
        } catch {
          // Permission denied or error
        }
        window.removeEventListener('touchstart', requestOnInteraction);
      };
      window.addEventListener('touchstart', requestOnInteraction, { once: true });
    } else if ('DeviceOrientationEvent' in window) {
      window.addEventListener('deviceorientation', handleOrientation);
    }

    return () => {
      window.removeEventListener('deviceorientation', handleOrientation);
    };
  }, []);

  return orientation;
}
