#!/usr/bin/env python3
"""Create the selectable-text Badge Blur macOS quick-start flyer."""

from pathlib import Path

from reportlab.lib.colors import HexColor, white
from reportlab.lib.pagesizes import letter
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "output" / "pdf" / "Badge-Blur-macOS-Quick-Start.pdf"
DESKTOP_OUTPUT = Path.home() / "Desktop" / OUTPUT.name
ICON = ROOT / "public" / "badge-blur.png"

PAGE_W, PAGE_H = letter

ORNL_GREEN = HexColor("#00662C")
HALE_NAVY = HexColor("#00454D")
DARK_MATTER = HexColor("#373A36")
GRAPHITE = HexColor("#DBDCDB")
MIST = HexColor("#F3F6F4")
ENERGY = HexColor("#7DBA00")
SOFT_GREEN = HexColor("#E8F2EA")
SOFT_NAVY = HexColor("#E7F0F1")


def draw_wrapped_text(
    pdf: canvas.Canvas,
    text: str,
    x: float,
    y: float,
    max_width: float,
    font: str,
    size: float,
    color=DARK_MATTER,
    leading: float | None = None,
) -> float:
    """Draw a simple word-wrapped paragraph and return the next baseline."""
    leading = leading or size * 1.35
    words = text.split()
    line = ""
    pdf.setFont(font, size)
    pdf.setFillColor(color)
    for word in words:
        candidate = f"{line} {word}".strip()
        if line and stringWidth(candidate, font, size) > max_width:
            pdf.drawString(x, y, line)
            y -= leading
            line = word
        else:
            line = candidate
    if line:
        pdf.drawString(x, y, line)
        y -= leading
    return y


def draw_label(pdf: canvas.Canvas, text: str, x: float, y: float, color=ORNL_GREEN) -> None:
    pdf.setFillColor(color)
    pdf.setFont("Helvetica-Bold", 8.5)
    pdf.drawString(x, y, text.upper())


def draw_code_block(
    pdf: canvas.Canvas,
    lines: list[str],
    x: float,
    top: float,
    width: float,
    height: float,
) -> None:
    pdf.setFillColor(HALE_NAVY)
    pdf.rect(x, top - height, width, height, stroke=0, fill=1)
    pdf.setFillColor(ENERGY)
    pdf.rect(x, top - height, 5, height, stroke=0, fill=1)
    pdf.setFont("Courier", 7.7)
    pdf.setFillColor(white)
    baseline = top - 20
    for line in lines:
        pdf.drawString(x + 15, baseline, line)
        baseline -= 14


def build_pdf(output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    pdf = canvas.Canvas(str(output), pagesize=letter, pageCompression=1)
    pdf.setTitle("Badge Blur macOS Quick Start")
    pdf.setAuthor("Badge Blur")
    pdf.setSubject("Selectable Terminal commands for installing and launching Badge Blur on macOS")

    # Page foundation: a restrained ORNL green/navy system with square geometry.
    pdf.setFillColor(white)
    pdf.rect(0, 0, PAGE_W, PAGE_H, stroke=0, fill=1)
    pdf.setFillColor(ORNL_GREEN)
    pdf.rect(0, PAGE_H - 166, PAGE_W, 166, stroke=0, fill=1)
    pdf.setFillColor(HALE_NAVY)
    pdf.rect(PAGE_W - 18, PAGE_H - 166, 18, 166, stroke=0, fill=1)
    pdf.setFillColor(ENERGY)
    pdf.rect(0, PAGE_H - 172, PAGE_W, 6, stroke=0, fill=1)

    draw_label(pdf, "ORNL workflow  |  macOS quick start", 40, 756, white)
    pdf.setFillColor(white)
    pdf.setFont("Helvetica-Bold", 28)
    pdf.drawString(40, 716, "Install once.")
    pdf.drawString(40, 684, "Launch anytime.")
    pdf.setFont("Helvetica", 11.5)
    pdf.drawString(40, 654, "Badge Blur runs locally after its first-time setup.")

    icon_size = 116
    pdf.drawImage(
        ImageReader(str(ICON)),
        442,
        641,
        width=icon_size,
        height=icon_size,
        preserveAspectRatio=True,
        mask="auto",
    )

    # First install / update.
    draw_label(pdf, "01  First install or update", 40, 594)
    y = draw_wrapped_text(
        pdf,
        "Open Terminal, copy both commands below, and press Return after each one. "
        "The second command installs, verifies, and launches Badge Blur.",
        40,
        575,
        532,
        "Helvetica",
        10,
        leading=13.5,
    )
    install_lines = [
        "/usr/bin/curl --fail --location --show-error \\",
        "  https://raw.githubusercontent.com/adammalin/Badge-Blur/main/scripts/bootstrap-mac-source-test.zsh \\",
        '  --output "$HOME/Downloads/badge-blur-install.zsh"',
        "",
        '/bin/zsh "$HOME/Downloads/badge-blur-install.zsh" \\',
        '  "$HOME/Badge-Blur-source-test"',
    ]
    draw_code_block(pdf, install_lines, 40, y - 5, 532, 108)
    pdf.setFillColor(SOFT_GREEN)
    pdf.rect(40, y - 141, 532, 23, stroke=0, fill=1)
    pdf.setFillColor(ORNL_GREEN)
    pdf.setFont("Helvetica-Bold", 8.5)
    pdf.drawString(
        51,
        y - 133,
        "TO UPDATE LATER: quit Badge Blur, then run these same two commands again.",
    )

    # Launch later.
    draw_label(pdf, "02  Start Badge Blur after it is installed", 40, 366)
    y2 = draw_wrapped_text(
        pdf,
        "For later sessions, open Terminal and run:",
        40,
        347,
        532,
        "Helvetica",
        10,
        leading=13,
    )
    launch_lines = [
        'cd "$HOME/Badge-Blur-source-test"',
        "/bin/zsh scripts/start-mac-source-test.zsh",
    ]
    draw_code_block(pdf, launch_lines, 40, y2 - 4, 532, 58)

    # What to expect.
    draw_label(pdf, "03  What to expect", 40, 247)
    cards = [
        (
            40,
            SOFT_GREEN,
            ORNL_GREEN,
            "LOCAL FOLDER",
            "~/Badge-Blur-source-test",
            "The installer creates or safely updates this recognized folder.",
        ),
        (
            220,
            SOFT_NAVY,
            HALE_NAVY,
            "FIRST SETUP",
            "Internet required",
            "Setup downloads verified runtime, packages, and model files.",
        ),
        (
            400,
            MIST,
            DARK_MATTER,
            "DAILY USE",
            "Local processing",
            "Use Command-Q to close the app and its private local service.",
        ),
    ]
    for x, fill, accent, title, value, note in cards:
        pdf.setFillColor(fill)
        pdf.rect(x, 142, 172, 87, stroke=0, fill=1)
        pdf.setFillColor(accent)
        pdf.rect(x, 142, 4, 87, stroke=0, fill=1)
        draw_label(pdf, title, x + 14, 211, accent)
        pdf.setFillColor(DARK_MATTER)
        pdf.setFont("Helvetica-Bold", 10.5)
        pdf.drawString(x + 14, 191, value)
        draw_wrapped_text(
            pdf,
            note,
            x + 14,
            174,
            144,
            "Helvetica",
            7.8,
            leading=10.3,
        )

    # Requirements and source.
    pdf.setFillColor(DARK_MATTER)
    pdf.rect(0, 0, PAGE_W, 116, stroke=0, fill=1)
    draw_label(pdf, "Requirements", 40, 92, ENERGY)
    pdf.setFillColor(white)
    pdf.setFont("Helvetica-Bold", 10.5)
    pdf.drawString(40, 72, "Apple silicon  ·  macOS 13 or later")
    pdf.setFont("Helvetica", 8.3)
    pdf.drawString(40, 55, "On a managed Mac, follow your organization’s approved software and support process.")
    url = "https://github.com/adammalin/Badge-Blur"
    pdf.setFillColor(ENERGY)
    pdf.setFont("Helvetica-Bold", 8.5)
    pdf.drawString(40, 32, url)
    pdf.linkURL(url, (40, 26, 250, 42), relative=0)

    pdf.setFillColor(GRAPHITE)
    pdf.setFont("Helvetica", 7.5)
    pdf.drawRightString(
        572,
        32,
        "Source install route · No sudo or system-wide Node install required",
    )

    pdf.showPage()
    pdf.save()


def main() -> None:
    build_pdf(OUTPUT)
    DESKTOP_OUTPUT.write_bytes(OUTPUT.read_bytes())
    print(OUTPUT)
    print(DESKTOP_OUTPUT)


if __name__ == "__main__":
    main()
