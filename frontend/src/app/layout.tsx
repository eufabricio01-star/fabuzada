import './globals.css';import type {Metadata} from 'next';
export const metadata:Metadata={title:'FABUZADA — Comunidade Gamer',description:'Seu QG gamer com chat, salas de voz e campeonatos.'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="pt-BR"><body>{children}</body></html>}
