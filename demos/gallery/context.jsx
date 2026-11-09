import { createContext, useContext } from 'react';

// What the header's switches decide, shared with the sections: the theme, the density, the phone preview and the header actions every section registers.
export const GalleryContext = createContext(null);
export const useGallery = () => useContext(GalleryContext);
