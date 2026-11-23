# Σελίδες PDF σε εικόνες και κείμενο με ό,τι έχουν ήδη τα Windows 10/11 (χωρίς λήψεις):
# Windows.Data.Pdf (σελίδα → εικόνα) και Windows.Media.Ocr (εικόνα → λέξεις με τα πλαίσιά τους).
# Εντολές από την είσοδο, μία ανά γραμμή (με tab):
#   render <σελίδα> <πλάτος σε pixel> <BMP ή κενό> <1 = OCR>   (σελίδα του -Pdf)
#   ocr <σελίδα> <BMP>                                        (OCR μιας εικόνας)
# Για κάθε εντολή γράφει μία γραμμή JSON (μόνο ASCII) στην έξοδο:
#   {"page":N,"w":W,"h":H,"angle":κλίση,"lines":[[[x,y,w,h,"λέξη"],…],…]}
# Η εικόνα του render είναι BMP 8 bit, γκρι, από πάνω προς τα κάτω· τη σβήνει όποιος τη διαβάσει.
param(
  [string]$Pdf = '',
  [string]$Lang = 'en-US'
)
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding $false

function Esc([string]$s) {
  $sb = New-Object System.Text.StringBuilder ($s.Length + 2)
  foreach ($c in $s.ToCharArray()) {
    $n = [int]$c
    if ($c -eq '"') { [void]$sb.Append('\"') }
    elseif ($c -eq '\') { [void]$sb.Append('\\') }
    elseif ($n -lt 32 -or $n -gt 126) { [void]$sb.Append(('\u{0:x4}' -f $n)) }
    else { [void]$sb.Append($c) }
  }
  $sb.ToString()
}

function Say([string]$line) {
  [Console]::Out.WriteLine($line)
  [Console]::Out.Flush()
}

try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
  $null = [Windows.Data.Pdf.PdfDocument, Windows.Data.Pdf, ContentType = WindowsRuntime]
  $null = [Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
  $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
  $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
  $null = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]

  # await των WinRT: IAsyncOperation<T> / IAsyncAction → Task
  $asTaskOp = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
  $asTaskAction = [System.WindowsRuntimeSystemExtensions].GetMethod('AsTask', [Type[]]@([Windows.Foundation.IAsyncAction]))
  function Await($op, [Type]$type) {
    $t = $asTaskOp.MakeGenericMethod($type).Invoke($null, @($op))
    [void]$t.Wait(-1)
    $t.Result
  }
  function AwaitAction($op) {
    $t = $asTaskAction.Invoke($null, @($op))
    [void]$t.Wait(-1)
  }

  $doc = $null
  $count = 0
  if ($Pdf) {
    $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync((Resolve-Path -LiteralPath $Pdf).ProviderPath)) ([Windows.Storage.StorageFile])
    $doc = Await ([Windows.Data.Pdf.PdfDocument]::LoadFromFileAsync($file)) ([Windows.Data.Pdf.PdfDocument])
    $count = [int]$doc.PageCount
  }
  $engine = $null
  foreach ($l in $Lang.Split(',')) {
    if (-not $engine -and $l.Trim()) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new($l.Trim())) }
  }
  if (-not $engine) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }
  # παλέτα γκρι για το BMP 8 bit
  $palette = New-Object byte[] 1024
  for ($i = 0; $i -lt 256; $i++) { $palette[4 * $i] = $i; $palette[4 * $i + 1] = $i; $palette[4 * $i + 2] = $i }
  Say ('{"pages":' + $count + ',"lang":"' + $(if ($engine) { Esc $engine.RecognizerLanguage.LanguageTag } else { '' }) + '"}')

  function Ocr($bmp, $json) {
    if (-not $engine) { [void]$json.Append(',"lines":[]'); return }
    $res = Await ($engine.RecognizeAsync($bmp)) ([Windows.Media.Ocr.OcrResult])
    $angle = if ($res.TextAngle -ne $null) { [math]::Round([double]$res.TextAngle, 3) } else { 0 }
    [void]$json.Append(',"angle":' + $angle + ',"lines":[')
    $first = $true
    foreach ($line in $res.Lines) {
      if (-not $first) { [void]$json.Append(',') }
      $first = $false
      [void]$json.Append('[')
      $fw = $true
      foreach ($word in $line.Words) {
        $r = $word.BoundingRect
        if (-not $fw) { [void]$json.Append(',') }
        $fw = $false
        [void]$json.Append('[' + [math]::Round($r.X, 1) + ',' + [math]::Round($r.Y, 1) + ',' + [math]::Round($r.Width, 1) + ',' + [math]::Round($r.Height, 1) + ',"' + (Esc $word.Text) + '"]')
      }
      [void]$json.Append(']')
    }
    [void]$json.Append(']')
  }

  while ($true) {
    $cmd = [Console]::In.ReadLine()
    if ($cmd -eq $null) { break }
    $parts = $cmd.Split("`t")
    if ($parts.Count -lt 3) { continue }
    $p = [int]$parts[1]
    try {
      $json = New-Object System.Text.StringBuilder
      if ($parts[0] -eq 'render') {
        if (-not $doc -or $p -lt 1 -or $p -gt $count) { throw "page $p" }
        $page = $doc.GetPage($p - 1)
        try {
          $w = [int]([math]::Floor([int]$parts[2] / 4) * 4)
          $h = [int][math]::Round($w * $page.Size.Height / $page.Size.Width)
          $opts = New-Object Windows.Data.Pdf.PdfPageRenderOptions
          $opts.DestinationWidth = [uint32]$w
          $opts.DestinationHeight = [uint32]$h
          $stream = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
          AwaitAction ($page.RenderToStreamAsync($stream, $opts))
          $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
          $color = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
          $bmp = [Windows.Graphics.Imaging.SoftwareBitmap]::Convert($color, [Windows.Graphics.Imaging.BitmapPixelFormat]::Gray8)
          $color.Dispose()
          [void]$json.Append('{"page":' + $p + ',"w":' + $w + ',"h":' + $h)
          if ($parts.Count -gt 3 -and $parts[3]) {
            $buf = New-Object Windows.Storage.Streams.Buffer ([uint32]($w * $h))
            $bmp.CopyToBuffer($buf)
            $bytes = [System.Runtime.InteropServices.WindowsRuntime.WindowsRuntimeBufferExtensions]::ToArray($buf)
            $fs = [System.IO.File]::Create($parts[3])
            try {
              $bw = New-Object System.IO.BinaryWriter $fs
              $off = 14 + 40 + 1024
              $bw.Write([byte]0x42); $bw.Write([byte]0x4D); $bw.Write([int]($off + $bytes.Length)); $bw.Write([int]0); $bw.Write([int]$off)
              $bw.Write([int]40); $bw.Write([int]$w); $bw.Write([int](-$h)); $bw.Write([int16]1); $bw.Write([int16]8); $bw.Write([int]0)
              $bw.Write([int]$bytes.Length); $bw.Write([int]2835); $bw.Write([int]2835); $bw.Write([int]256); $bw.Write([int]0)
              $bw.Write($palette); $bw.Write($bytes); $bw.Flush()
            } finally { $fs.Dispose() }
          }
          if ($parts.Count -gt 4 -and $parts[4] -eq '1') { Ocr $bmp $json }
          $bmp.Dispose()
          $stream.Dispose()
        } finally { $page.Dispose() }
      } elseif ($parts[0] -eq 'ocr') {
        $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($parts[2])) ([Windows.Storage.StorageFile])
        $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
        try {
          $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
          $color = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
          $bmp = [Windows.Graphics.Imaging.SoftwareBitmap]::Convert($color, [Windows.Graphics.Imaging.BitmapPixelFormat]::Gray8)
          $color.Dispose()
          [void]$json.Append('{"page":' + $p + ',"w":' + $bmp.PixelWidth + ',"h":' + $bmp.PixelHeight)
          Ocr $bmp $json
          $bmp.Dispose()
        } finally { $stream.Dispose() }
      } else { continue }
      [void]$json.Append('}')
      Say $json.ToString()
    } catch {
      Say ('{"page":' + $p + ',"error":"' + (Esc $_.Exception.Message) + '"}')
    }
  }
} catch {
  Say ('{"error":"' + (Esc $_.Exception.Message) + '"}')
  exit 1
}
