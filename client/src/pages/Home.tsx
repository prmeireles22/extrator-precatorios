import { useState, useRef, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { 
  Upload, 
  FileText, 
  Download, 
  Filter, 
  BarChart3, 
  Scale, 
  FileSpreadsheet,
  CheckCircle2,
  AlertCircle,
  Loader2,
  X,
  Search,
  Building2
} from "lucide-react";
import * as pdfjsLib from "pdfjs-dist";
import * as XLSX from "xlsx";

// Configure PDF.js worker - use the local worker from node_modules
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

interface ProcessoInfo {
  numero: string;
  credor: string;
  devedor: string;
  valor: string;
  valorNumerico: number;
  natureza: string;
  regime: string;
  orcamentoReferencia: string;
  dataAtualizacao: string;
  tipoDecisao: string;
  destaqueHonorarios: string;
  advogados: string;
  textoDecisao: string;
  pagina: number;
  tipoExtracao: string; // "Expedição", "Inclusão" ou "Ambos"
}

interface ExtractionStats {
  total: number;
  comValor: number;
  alimentar: number;
  comum: number;
  valorTotal: number;
}

type FilterType = "filter1" | "filter2";

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState("");
  const [processos, setProcessos] = useState<ProcessoInfo[]>([]);
  const [stats, setStats] = useState<ExtractionStats | null>(null);
  const [activeFilter, setActiveFilter] = useState<FilterType>("filter1");
  const [extractedText, setExtractedText] = useState<string>("");
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile && droppedFile.type === "application/pdf") {
      setFile(droppedFile);
      setProcessos([]);
      setStats(null);
      setExtractedText("");
      toast.success("PDF carregado com sucesso!");
    } else {
      toast.error("Por favor, selecione um arquivo PDF válido.");
    }
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile && selectedFile.type === "application/pdf") {
      setFile(selectedFile);
      setProcessos([]);
      setStats(null);
      setExtractedText("");
      toast.success("PDF carregado com sucesso!");
    } else {
      toast.error("Por favor, selecione um arquivo PDF válido.");
    }
  }, []);

  const removeFile = useCallback(() => {
    setFile(null);
    setProcessos([]);
    setStats(null);
    setExtractedText("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  // Reprocessar automaticamente quando o filtro mudar e já houver texto extraído
  useEffect(() => {
    if (extractedText && !isProcessing) {
      console.log(`Filtro alterado para: ${activeFilter}. Reprocessando...`);
      const processosExtraidos = processarProcessos(extractedText, activeFilter);
      setProcessos(processosExtraidos);
      setStats(calcularEstatisticas(processosExtraidos));
      toast.success(`${processosExtraidos.length} processos encontrados com o filtro ${activeFilter === "filter1" ? "Expedição" : "Inclusão"}!`);
    }
  }, [activeFilter]);

  const extractTextFromPDF = async (pdfFile: File): Promise<string> => {
    const arrayBuffer = await pdfFile.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const numPages = pdf.numPages;
    let fullText = "";

    for (let i = 1; i <= numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      
      // Melhor extração de texto preservando estrutura
      // Adicionar marcador de página para rastreamento
      const pageText = textContent.items
        .map((item: any) => item.str)
        .join(" ");
      fullText += `\n[[[PAGINA_${i}]]]\n` + pageText;
      
      setProgress(Math.round((i / numPages) * 50));
      setProgressMessage(`Extraindo texto: página ${i} de ${numPages}`);
    }

    return fullText;
  };

  const limparTexto = (texto: string): string => {
    return texto.replace(/\s+/g, " ").trim();
  };

  const extrairValor = (texto: string): string => {
    const match = texto.match(/R\$\s*([\d.,]+)/);
    return match ? match[0] : "";
  };

  const extrairValorNumerico = (texto: string): number => {
    const match = texto.match(/R\$\s*([\d.]+),(\d{2})/);
    if (match) {
      const valorStr = match[1].replace(/\./g, "") + "." + match[2];
      return parseFloat(valorStr) || 0;
    }
    return 0;
  };

  const extrairNomeCredor = (bloco: string): string => {
    const patterns = [
      /favor\s+de\s+([A-ZÀ-Ú][a-zà-ú]+(?:\s+(?:de|da|do|dos|das|e)?\s*[A-ZÀ-Ú]?[a-zà-ú]+)*)\s+contra/i,
      /Credor:\s*([A-ZÀ-Ú][a-zà-ú]+(?:\s+(?:de|da|do|dos|das|e)?\s*[A-ZÀ-Ú]?[a-zà-ú]+)*)/i,
      /Credora:\s*([A-ZÀ-Ú][a-zà-ú]+(?:\s+(?:de|da|do|dos|das|e)?\s*[A-ZÀ-Ú]?[a-zà-ú]+)*)/i,
    ];

    for (const pattern of patterns) {
      const match = bloco.match(pattern);
      if (match) {
        let nome = match[1].trim();
        nome = nome.replace(/\s+(contra|em|no|na|do|da|de)$/i, "");
        if (nome.length > 3) return nome;
      }
    }
    return "";
  };

  const processarProcessos = (texto: string, filterType: FilterType): ProcessoInfo[] => {
    // Dividir o texto em blocos usando o padrão de número de processo
    // O padrão é mais flexível para capturar diferentes formatos
    const blocos = texto.split(/(?=Nº\s+\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4})/);
    
    const processosEncontrados: ProcessoInfo[] = [];
    const numerosVistos = new Set<string>();

    console.log("=== PROCESSAMENTO ===");
    console.log(`Filtro ativo: ${filterType}`);
    console.log(`Total de blocos encontrados: ${blocos.length}`);

    let countFilter1Match = 0;
    let countFilter2Match = 0;

    blocos.forEach((bloco, index) => {
      const blocoLower = bloco.toLowerCase();
      
      // Verificar critérios do Filtro 1
      const temPrecatorio = blocoLower.includes("precatório") || blocoLower.includes("precatorio");
      const temExpedicao = blocoLower.includes("expedida") || blocoLower.includes("expedição") || 
                         blocoLower.includes("expedicao") || blocoLower.includes("expedido");
      const temDevedorAlagoas = blocoLower.includes("devedor: estado de alagoas") || 
                                blocoLower.includes("devedor : estado de alagoas");
      const matchFilter1 = temPrecatorio && temExpedicao && temDevedorAlagoas;
      
      // Verificar critérios do Filtro 2
      const temContraEstado = blocoLower.includes("contra o estado de alagoas");
      const temInclusao = blocoLower.includes("inclusão deste precatório") || 
                        blocoLower.includes("inclusao deste precatorio") ||
                        blocoLower.includes("inclusão deste precatorio") ||
                        blocoLower.includes("inclusao deste precatório") ||
                        blocoLower.includes("inclusão deste precatório");
      const matchFilter2 = temContraEstado && temInclusao;

      if (matchFilter1) countFilter1Match++;
      if (matchFilter2) countFilter2Match++;
      
      // Aplicar o filtro selecionado
      let matchesCriteria = false;
      if (filterType === "filter1") {
        matchesCriteria = matchFilter1;
      } else {
        matchesCriteria = matchFilter2;
      }

      if (matchesCriteria) {
        const matchNum = bloco.match(/Nº\s+(\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4})/);
        if (matchNum) {
          const numeroProcesso = matchNum[1];
          
          if (numerosVistos.has(numeroProcesso)) return;
          numerosVistos.add(numeroProcesso);

          // Extrair número da página do marcador
          const matchPagina = bloco.match(/\[\[\[PAGINA_(\d+)\]\]\]/);
          const pagina = matchPagina ? parseInt(matchPagina[1]) : 0;

          // Determinar tipo de extração (pode ser ambos)
          let tipoExtracao = "";
          if (matchFilter1 && matchFilter2) {
            tipoExtracao = "Ambos";
          } else if (matchFilter1) {
            tipoExtracao = "Expedição";
          } else if (matchFilter2) {
            tipoExtracao = "Inclusão";
          }

          const credor = extrairNomeCredor(bloco);
          const valor = extrairValor(bloco);
          const valorNumerico = extrairValorNumerico(bloco);

          let natureza = "";
          if (blocoLower.includes("natureza alimentar")) {
            natureza = "Alimentar";
          } else if (blocoLower.includes("natureza comum")) {
            natureza = "Comum";
          } else if (blocoLower.includes("crédito alimentar") || blocoLower.includes("credito alimentar")) {
            natureza = "Alimentar";
          } else if (blocoLower.includes("crédito de natureza comum") || blocoLower.includes("credito de natureza comum")) {
            natureza = "Comum";
          }

          let regime = "";
          if (blocoLower.includes("regime geral")) {
            regime = "Regime Geral";
          } else if (blocoLower.includes("regime especial")) {
            regime = "Regime Especial";
          }

          const matchOrcamento = bloco.match(/orçamento\s+(?:de\s+)?(\d{4})/i);
          const orcamento = matchOrcamento ? matchOrcamento[1] : "";

          const matchData = bloco.match(/atualizado\s+em\s+(\d{2}\/\d{2}\/\d{4})/i);
          const dataAtualizacao = matchData ? matchData[1] : "";

          let tipoDecisao = "";
          if (bloco.includes("'DECISÃO") || bloco.includes("DECISÃO 01") || bloco.includes("DECISÃO")) {
            tipoDecisao = "DECISÃO";
          } else if (bloco.includes("'DESPACHO") || bloco.includes("DESPACHO 01") || bloco.includes("DESPACHO")) {
            tipoDecisao = "DESPACHO";
          }

          const matchDestaque = bloco.match(/destaque\s+de\s+(\d+)\s*%?\s*\(/i);
          const destaqueHonorarios = matchDestaque ? matchDestaque[1] + "%" : "";

          let advogados = "";
          const matchAdvs = bloco.match(/Advs?:\s*([^0-9]+?)(?:\s*-\s*\d|\s*$)/);
          if (matchAdvs) {
            advogados = limparTexto(matchAdvs[1]);
            if (advogados.length > 200) advogados = advogados.substring(0, 200) + "...";
          }

          let textoDecisao = limparTexto(bloco);
          if (textoDecisao.length > 1000) textoDecisao = textoDecisao.substring(0, 1000) + "...";

          processosEncontrados.push({
            numero: numeroProcesso,
            credor,
            devedor: "Estado de Alagoas",
            valor,
            valorNumerico,
            natureza,
            regime,
            orcamentoReferencia: orcamento,
            dataAtualizacao,
            tipoDecisao,
            destaqueHonorarios,
            advogados,
            textoDecisao,
            pagina,
            tipoExtracao,
          });
        }
      }

      if (index % 100 === 0) {
        setProgress(50 + Math.round((index / blocos.length) * 50));
        setProgressMessage(`Processando blocos: ${index + 1} de ${blocos.length}`);
      }
    });

    // Contar processos únicos para cada filtro
    const processosFilter1 = new Set<string>();
    const processosFilter2 = new Set<string>();
    
    blocos.forEach((bloco) => {
      const blocoLower = bloco.toLowerCase();
      const matchNum = bloco.match(/Nº\s+(\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4})/);
      if (!matchNum) return;
      
      const numero = matchNum[1];
      
      // Verificar Filtro 1
      const temPrecatorio = blocoLower.includes("precatório") || blocoLower.includes("precatorio");
      const temExpedicao = blocoLower.includes("expedida") || blocoLower.includes("expedição") || 
                         blocoLower.includes("expedicao") || blocoLower.includes("expedido");
      const temDevedorAlagoas = blocoLower.includes("devedor: estado de alagoas") || 
                                blocoLower.includes("devedor : estado de alagoas");
      if (temPrecatorio && temExpedicao && temDevedorAlagoas) {
        processosFilter1.add(numero);
      }
      
      // Verificar Filtro 2
      const temContraEstado = blocoLower.includes("contra o estado de alagoas");
      const temInclusao = blocoLower.includes("inclusão deste precatório") || 
                        blocoLower.includes("inclusao deste precatorio") ||
                        blocoLower.includes("inclusão deste precatorio") ||
                        blocoLower.includes("inclusao deste precatório") ||
                        blocoLower.includes("inclusão deste precatório");
      if (temContraEstado && temInclusao) {
        processosFilter2.add(numero);
      }
    });

    console.log("%c=== CONTAGEM DE PROCESSOS POR FILTRO ===", "background: #1E3A5F; color: white; padding: 4px 8px; font-weight: bold;");
    console.log("%cFiltro 1 (Expedição de Precatórios):", "color: #059669; font-weight: bold;", `${processosFilter1.size} processos únicos`);
    console.log("  Critérios: Precatório + Expedição + Devedor: Estado de Alagoas");
    console.log("%cFiltro 2 (Inclusão de Precatórios):", "color: #7C3AED; font-weight: bold;", `${processosFilter2.size} processos únicos`);
    console.log("  Critérios: contra o Estado de Alagoas + INCLUSÃO deste precatório");
    console.log("%c=== FILTRO APLICADO ===", "background: #374151; color: white; padding: 4px 8px;");
    console.log(`Filtro selecionado: ${filterType === "filter1" ? "Expedição" : "Inclusão"}`);
    console.log(`Processos retornados: ${processosEncontrados.length}`);
    
    return processosEncontrados.sort((a, b) => b.valorNumerico - a.valorNumerico);
  };

  const calcularEstatisticas = (procs: ProcessoInfo[]): ExtractionStats => {
    return {
      total: procs.length,
      comValor: procs.filter(p => p.valor !== "").length,
      alimentar: procs.filter(p => p.natureza === "Alimentar").length,
      comum: procs.filter(p => p.natureza === "Comum").length,
      valorTotal: procs.reduce((sum, p) => sum + p.valorNumerico, 0),
    };
  };

  const handleProcess = async () => {
    if (!file) {
      toast.error("Por favor, selecione um arquivo PDF primeiro.");
      return;
    }

    setIsProcessing(true);
    setProgress(0);
    setProgressMessage("Iniciando extração...");

    try {
      const texto = await extractTextFromPDF(file);
      setExtractedText(texto);
      
      console.log(`Texto extraído: ${texto.length} caracteres`);
      
      setProgressMessage("Processando processos...");
      const processosExtraidos = processarProcessos(texto, activeFilter);
      
      setProcessos(processosExtraidos);
      setStats(calcularEstatisticas(processosExtraidos));
      setProgress(100);
      setProgressMessage("Processamento concluído!");
      toast.success(`${processosExtraidos.length} processos encontrados!`);
    } catch (error) {
      console.error("Erro ao processar PDF:", error);
      toast.error("Erro ao processar PDF: " + (error as Error).message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReprocess = async () => {
    if (!extractedText) {
      toast.error("Nenhum texto extraído. Por favor, processe o PDF primeiro.");
      return;
    }

    setIsProcessing(true);
    setProgress(0);
    setProgressMessage("Reprocessando com novo filtro...");

    try {
      const processosExtraidos = processarProcessos(extractedText, activeFilter);
      setProcessos(processosExtraidos);
      setStats(calcularEstatisticas(processosExtraidos));
      setProgress(100);
      setProgressMessage("Processamento concluído!");
      toast.success(`${processosExtraidos.length} processos encontrados com o novo filtro!`);
    } catch (error) {
      console.error("Erro ao reprocessar:", error);
      toast.error("Erro ao reprocessar os dados.");
    } finally {
      setIsProcessing(false);
    }
  };

  const formatCurrency = (value: number): string => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(value);
  };

  const exportToJSON = () => {
    if (processos.length === 0) {
      toast.error("Nenhum processo para exportar.");
      return;
    }

    const dataStr = JSON.stringify(processos, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `precatorios_${activeFilter === "filter1" ? "expedicao" : "inclusao"}_${new Date().toISOString().split("T")[0]}.json`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success("Arquivo JSON exportado com sucesso!");
  };

  const exportToExcel = () => {
    if (processos.length === 0) {
      toast.error("Nenhum processo para exportar.");
      return;
    }

    // Criar workbook
    const wb = XLSX.utils.book_new();

    // === ABA 1: RESUMO ===
    const resumoData = [
      ["EXTRAÇÃO DE PRECATÓRIOS - ESTADO DE ALAGOAS"],
      ["Diário Oficial - Caderno Jurisdicional - Segundo Grau"],
      [`Filtro: ${activeFilter === "filter1" ? "Expedição de Precatórios" : "Inclusão de Precatórios"}`],
      [`Gerado em: ${new Date().toLocaleString("pt-BR")}`],
      [],
      ["ESTATÍSTICAS GERAIS"],
      ["Total de Processos", stats?.total || 0],
      ["Processos com Valor", stats?.comValor || 0],
      ["Natureza Alimentar", stats?.alimentar || 0],
      ["Natureza Comum", stats?.comum || 0],
      ["Valor Total", formatCurrency(stats?.valorTotal || 0)],
      [],
      ["DISTRIBUIÇÃO POR NATUREZA"],
      ["Natureza", "Quantidade", "Valor Total", "% do Total"],
      ["Alimentar", stats?.alimentar || 0, formatCurrency(processos.filter(p => p.natureza === "Alimentar").reduce((s, p) => s + p.valorNumerico, 0)), stats?.valorTotal ? ((processos.filter(p => p.natureza === "Alimentar").reduce((s, p) => s + p.valorNumerico, 0) / stats.valorTotal) * 100).toFixed(1) + "%" : "0%"],
      ["Comum", stats?.comum || 0, formatCurrency(processos.filter(p => p.natureza === "Comum").reduce((s, p) => s + p.valorNumerico, 0)), stats?.valorTotal ? ((processos.filter(p => p.natureza === "Comum").reduce((s, p) => s + p.valorNumerico, 0) / stats.valorTotal) * 100).toFixed(1) + "%" : "0%"],
    ];
    const wsResumo = XLSX.utils.aoa_to_sheet(resumoData);
    wsResumo["!cols"] = [{ wch: 30 }, { wch: 20 }, { wch: 25 }, { wch: 15 }];
    XLSX.utils.book_append_sheet(wb, wsResumo, "Resumo");

    // === ABA 2: PROCESSOS ===
    const processosData = [
      ["Página", "Tipo Extração", "Nº Processo", "Credor", "Devedor", "Valor", "Natureza", "Regime", "Orçamento", "Data Atualização", "Tipo Decisão", "Destaque Hon.", "Advogados"],
      ...processos.map(p => [
        p.pagina || "-",
        p.tipoExtracao || "-",
        p.numero,
        p.credor,
        p.devedor,
        p.valor,
        p.natureza,
        p.regime,
        p.orcamentoReferencia,
        p.dataAtualizacao,
        p.tipoDecisao,
        p.destaqueHonorarios,
        p.advogados,
      ])
    ];
    const wsProcessos = XLSX.utils.aoa_to_sheet(processosData);
    wsProcessos["!cols"] = [
      { wch: 8 },  // Página
      { wch: 12 }, // Tipo Extração
      { wch: 28 }, // Nº Processo
      { wch: 35 }, // Credor
      { wch: 18 }, // Devedor
      { wch: 18 }, // Valor
      { wch: 12 }, // Natureza
      { wch: 15 }, // Regime
      { wch: 12 }, // Orçamento
      { wch: 15 }, // Data Atualização
      { wch: 12 }, // Tipo Decisão
      { wch: 12 }, // Destaque Hon.
      { wch: 50 }, // Advogados
    ];
    XLSX.utils.book_append_sheet(wb, wsProcessos, "Processos");

    // === ABA 3: TOP 50 ===
    const top50 = processos.slice(0, 50);
    const top50Data = [
      ["Rank", "Página", "Tipo Extração", "Nº Processo", "Credor", "Valor", "Natureza", "Orçamento", "Data Atualização"],
      ...top50.map((p, i) => [
        i + 1,
        p.pagina || "-",
        p.tipoExtracao || "-",
        p.numero,
        p.credor,
        p.valor,
        p.natureza,
        p.orcamentoReferencia,
        p.dataAtualizacao,
      ])
    ];
    const wsTop50 = XLSX.utils.aoa_to_sheet(top50Data);
    wsTop50["!cols"] = [
      { wch: 8 },  // Rank
      { wch: 8 },  // Página
      { wch: 12 }, // Tipo Extração
      { wch: 28 }, // Nº Processo
      { wch: 35 }, // Credor
      { wch: 20 }, // Valor
      { wch: 12 }, // Natureza
      { wch: 12 }, // Orçamento
      { wch: 15 }, // Data Atualização
    ];
    XLSX.utils.book_append_sheet(wb, wsTop50, "Top 50 por Valor");

    // Exportar
    const fileName = `Precatorios_${activeFilter === "filter1" ? "Expedicao" : "Inclusao"}_${new Date().toISOString().split("T")[0]}.xlsx`;
    XLSX.writeFile(wb, fileName);
    toast.success("Arquivo Excel exportado com sucesso!");
  };

  const exportToCSV = () => {
    if (processos.length === 0) {
      toast.error("Nenhum processo para exportar.");
      return;
    }

    const headers = ["Número", "Credor", "Devedor", "Valor", "Natureza", "Regime", "Orçamento", "Data Atualização", "Tipo Decisão", "Destaque Honorários", "Advogados"];
    const csvContent = [
      headers.join(";"),
      ...processos.map(p => [
        p.numero,
        p.credor,
        p.devedor,
        p.valor,
        p.natureza,
        p.regime,
        p.orcamentoReferencia,
        p.dataAtualizacao,
        p.tipoDecisao,
        p.destaqueHonorarios,
        p.advogados.replace(/;/g, ","),
      ].join(";"))
    ].join("\n");

    const blob = new Blob(["\ufeff" + csvContent], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `precatorios_${activeFilter === "filter1" ? "expedicao" : "inclusao"}_${new Date().toISOString().split("T")[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success("Arquivo CSV exportado com sucesso!");
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-[#1E3A5F] text-white shadow-lg">
        <div className="container py-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/10 rounded-lg">
              <Scale className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold">Extrator de Precatórios</h1>
              <p className="text-sm text-white/70">Diário Oficial - Tribunal de Justiça</p>
            </div>
          </div>
        </div>
      </header>

      <main className="container py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - Upload & Filters */}
          <div className="lg:col-span-1 space-y-6">
            {/* Upload Card */}
            <Card className="shadow-md">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Upload className="h-5 w-5 text-[#1E3A5F]" />
                  Upload do PDF
                </CardTitle>
                <CardDescription>
                  Arraste ou selecione o PDF do Diário Oficial
                </CardDescription>
              </CardHeader>
              <CardContent>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf"
                  onChange={handleFileSelect}
                  className="hidden"
                  id="pdf-upload"
                />
                
                {!file ? (
                  <label
                    htmlFor="pdf-upload"
                    className={`dropzone cursor-pointer block ${isDragOver ? "drag-over" : ""}`}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                  >
                    <FileText className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
                    <p className="text-sm text-muted-foreground">
                      Arraste o PDF aqui ou clique para selecionar
                    </p>
                    <p className="text-xs text-muted-foreground/70 mt-1">
                      Suporta PDFs do Diário Oficial
                    </p>
                  </label>
                ) : (
                  <div className="border rounded-lg p-4 bg-emerald-50 border-emerald-200">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-emerald-100 rounded-lg">
                          <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                        </div>
                        <div>
                          <p className="font-medium text-sm text-emerald-900">{file.name}</p>
                          <p className="text-xs text-emerald-700">
                            {(file.size / (1024 * 1024)).toFixed(2)} MB
                          </p>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-emerald-700 hover:text-red-600 hover:bg-red-50"
                        onClick={removeFile}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Filter Options */}
            <Card className="shadow-md">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Filter className="h-5 w-5 text-[#1E3A5F]" />
                  Tipo de Extração
                </CardTitle>
                <CardDescription>
                  Selecione o critério de filtragem
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div
                  className={`p-4 border rounded-lg cursor-pointer transition-all ${
                    activeFilter === "filter1"
                      ? "border-[#1E3A5F] bg-[#1E3A5F]/5 ring-2 ring-[#1E3A5F]/20"
                      : "border-border hover:border-[#1E3A5F]/50"
                  }`}
                  onClick={() => setActiveFilter("filter1")}
                >
                  <div className="flex items-start gap-3">
                    <div className={`w-4 h-4 rounded-full border-2 mt-0.5 flex items-center justify-center ${
                      activeFilter === "filter1" ? "border-[#1E3A5F] bg-[#1E3A5F]" : "border-gray-300"
                    }`}>
                      {activeFilter === "filter1" && <div className="w-2 h-2 bg-white rounded-full" />}
                    </div>
                    <div>
                      <p className="font-medium text-sm">Expedição de Precatórios</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Precatório + Expedição + Devedor: Estado de Alagoas
                      </p>
                    </div>
                  </div>
                </div>

                <div
                  className={`p-4 border rounded-lg cursor-pointer transition-all ${
                    activeFilter === "filter2"
                      ? "border-[#1E3A5F] bg-[#1E3A5F]/5 ring-2 ring-[#1E3A5F]/20"
                      : "border-border hover:border-[#1E3A5F]/50"
                  }`}
                  onClick={() => setActiveFilter("filter2")}
                >
                  <div className="flex items-start gap-3">
                    <div className={`w-4 h-4 rounded-full border-2 mt-0.5 flex items-center justify-center ${
                      activeFilter === "filter2" ? "border-[#1E3A5F] bg-[#1E3A5F]" : "border-gray-300"
                    }`}>
                      {activeFilter === "filter2" && <div className="w-2 h-2 bg-white rounded-full" />}
                    </div>
                    <div>
                      <p className="font-medium text-sm">Inclusão de Precatórios</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Contra o Estado de Alagoas + INCLUSÃO deste precatório
                      </p>
                    </div>
                  </div>
                </div>

                <Button
                  className="w-full mt-4 bg-[#1E3A5F] hover:bg-[#2D5A8A]"
                  onClick={extractedText ? handleReprocess : handleProcess}
                  disabled={!file || isProcessing}
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Processando...
                    </>
                  ) : (
                    <>
                      <Search className="mr-2 h-4 w-4" />
                      {extractedText ? "Aplicar Filtro" : "Processar PDF"}
                    </>
                  )}
                </Button>

                {isProcessing && (
                  <div className="space-y-2">
                    <Progress value={progress} className="h-2" />
                    <p className="text-xs text-center text-muted-foreground">
                      {progressMessage}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Export Options */}
            {processos.length > 0 && (
              <Card className="shadow-md">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Download className="h-5 w-5 text-[#1E3A5F]" />
                    Exportar Dados
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <Button
                    variant="outline"
                    className="w-full justify-start bg-emerald-50 hover:bg-emerald-100 border-emerald-200"
                    onClick={exportToExcel}
                  >
                    <FileSpreadsheet className="mr-2 h-4 w-4 text-emerald-600" />
                    Exportar Excel (.xlsx)
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full justify-start"
                    onClick={exportToCSV}
                  >
                    <FileSpreadsheet className="mr-2 h-4 w-4 text-gray-600" />
                    Exportar CSV
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full justify-start"
                    onClick={exportToJSON}
                  >
                    <FileText className="mr-2 h-4 w-4 text-blue-600" />
                    Exportar JSON
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Right Column - Results */}
          <div className="lg:col-span-2 space-y-6">
            {/* Statistics */}
            {stats && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 animate-fade-in">
                <Card className="shadow-md">
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-blue-100 rounded-lg">
                        <BarChart3 className="h-5 w-5 text-blue-600" />
                      </div>
                      <div>
                        <p className="text-2xl font-bold text-[#1E3A5F]">{stats.total}</p>
                        <p className="text-xs text-muted-foreground">Total de Processos</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card className="shadow-md">
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-emerald-100 rounded-lg">
                        <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                      </div>
                      <div>
                        <p className="text-2xl font-bold text-emerald-600">{stats.comValor}</p>
                        <p className="text-xs text-muted-foreground">Com Valor</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card className="shadow-md">
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-amber-100 rounded-lg">
                        <Scale className="h-5 w-5 text-amber-600" />
                      </div>
                      <div>
                        <p className="text-2xl font-bold text-amber-600">{stats.alimentar}</p>
                        <p className="text-xs text-muted-foreground">Alimentar</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card className="shadow-md">
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-purple-100 rounded-lg">
                        <Building2 className="h-5 w-5 text-purple-600" />
                      </div>
                      <div>
                        <p className="text-2xl font-bold text-purple-600">{stats.comum}</p>
                        <p className="text-xs text-muted-foreground">Comum</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Total Value */}
            {stats && stats.valorTotal > 0 && (
              <Card className="shadow-md bg-gradient-to-r from-[#1E3A5F] to-[#2D5A8A] text-white">
                <CardContent className="py-6">
                  <div className="text-center">
                    <p className="text-sm text-white/70 mb-1">Valor Total dos Precatórios</p>
                    <p className="text-3xl font-bold font-mono">{formatCurrency(stats.valorTotal)}</p>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Process List */}
            <Card className="shadow-md">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Scale className="h-5 w-5 text-[#1E3A5F]" />
                  Processos Encontrados
                </CardTitle>
                {processos.length > 0 && (
                  <CardDescription>
                    Ordenados por valor (maior para menor)
                  </CardDescription>
                )}
              </CardHeader>
              <CardContent>
                {processos.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <FileText className="h-12 w-12 mx-auto mb-4 opacity-30" />
                    <p>Nenhum processo encontrado.</p>
                    <p className="text-sm mt-1">Faça upload de um PDF e clique em "Processar PDF"</p>
                  </div>
                ) : (
                  <ScrollArea className="h-[500px]">
                    <div className="space-y-3">
                      {processos.map((processo, index) => (
                        <div
                          key={processo.numero}
                          className="p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-2 flex-wrap">
                                <Badge variant="outline" className="font-mono text-xs">
                                  #{index + 1}
                                </Badge>
                                {processo.pagina > 0 && (
                                  <Badge variant="outline" className="text-xs bg-gray-100">
                                    Pág. {processo.pagina}
                                  </Badge>
                                )}
                                <Badge 
                                  variant="outline" 
                                  className={`text-xs ${
                                    processo.tipoExtracao === "Ambos" 
                                      ? "bg-purple-100 text-purple-700 border-purple-300" 
                                      : processo.tipoExtracao === "Expedição" 
                                        ? "bg-emerald-100 text-emerald-700 border-emerald-300"
                                        : "bg-blue-100 text-blue-700 border-blue-300"
                                  }`}
                                >
                                  {processo.tipoExtracao || "N/A"}
                                </Badge>
                                <span className="font-mono text-sm text-[#1E3A5F] font-medium truncate">
                                  {processo.numero}
                                </span>
                              </div>
                              <p className="font-medium text-sm mb-1">{processo.credor || "Credor não identificado"}</p>
                              <div className="flex flex-wrap gap-2 text-xs">
                                {processo.natureza && (
                                  <Badge variant={processo.natureza === "Alimentar" ? "default" : "secondary"}>
                                    {processo.natureza}
                                  </Badge>
                                )}
                                {processo.orcamentoReferencia && (
                                  <Badge variant="outline">Orç. {processo.orcamentoReferencia}</Badge>
                                )}
                                {processo.dataAtualizacao && (
                                  <span className="text-muted-foreground">Atualizado: {processo.dataAtualizacao}</span>
                                )}
                              </div>
                            </div>
                            <div className="text-right">
                              {processo.valor ? (
                                <p className="font-mono font-bold text-emerald-600">{processo.valor}</p>
                              ) : (
                                <p className="text-xs text-muted-foreground">Valor não identificado</p>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t mt-12 py-6 text-center text-sm text-muted-foreground">
        <p>Extrator de Precatórios - Ferramenta para análise de Diários Oficiais</p>
      </footer>

      <style>{`
        .dropzone {
          border: 2px dashed #e2e8f0;
          border-radius: 0.5rem;
          padding: 2rem;
          text-align: center;
          transition: all 0.2s;
        }
        .dropzone:hover, .dropzone.drag-over {
          border-color: #1E3A5F;
          background-color: rgba(30, 58, 95, 0.05);
        }
        .animate-fade-in {
          animation: fadeIn 0.3s ease-in-out;
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
