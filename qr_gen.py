import base64

def generate_custom_qr_svg(data: str, color: str = "#000000", logo_path=None, size: int = 300) -> str:
    from math import ceil

    import qrcode
    qr = qrcode.QRCode(version=None, error_correction=qrcode.constants.ERROR_CORRECT_H, box_size=10, border=4)
    qr.add_data(data)
    qr.make(fit=True)
    matrix = qr.get_matrix()
    n = len(matrix)

    module_size = size / n
    cutout_radius = size * 0.15

    svg = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 {size} {size}">',
        f'<rect width="100%" height="100%" fill="white"/>'
    ]

    for y, row in enumerate(matrix):
        for x, cell in enumerate(row):
            if cell:
                cx = x * module_size
                cy = y * module_size
                svg.append(
                    f'<rect x="{cx}" y="{cy}" width="{module_size}" height="{module_size}" '
                    f'rx="{module_size/3}" ry="{module_size/3}" fill="{color}"/>'
                )

    svg.append(
        f'<circle cx="{size/2}" cy="{size/2}" r="{cutout_radius}" fill="white"/>'
    )

    if logo_path:
        with open(logo_path, "rb") as f:
            data_bytes = f.read()
            if logo_path.lower().endswith(".svg"):
                logo_data = data_bytes.decode("utf-8")
                svg.append(
                    f'<g transform="translate({size/2 - cutout_radius/2},{size/2 - cutout_radius/2})">'
                    f'{logo_data}</g>'
                )
            else:
                encoded = base64.b64encode(data_bytes).decode("utf-8")
                logo_size = cutout_radius * 1.5
                svg.append(
                    f'<image x="{size/2 - logo_size/2}" y="{size/2 - logo_size/2}" '
                    f'width="{logo_size}" height="{logo_size}" '
                    f'href="data:image/png;base64,{encoded}" />'
                )

    svg.append('</svg>')
    return "\n".join(svg)
