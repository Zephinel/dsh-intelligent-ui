/** Container-expansion fixture for M4-4 nested editing/renderer checks. */
export const NESTED_CONTAINERS_TITLE = '嵌套容器样例'

export const NESTED_CONTAINERS_PROGRAM = `root = Col([boxCard, gridCard, sectionCard, carouselCard])
boxCard = Card([Title("Box 容器", "sm"), Box([Text("box one", "sm"), Text("box two", "sm")], "col", 2)])
gridCard = Card([Title("Grid 容器", "sm"), Grid([Text("grid one", "sm"), Text("grid two", "sm")], 2)])
sectionCard = Section("Section 容器", [Text("section one", "sm"), Text("section two", "sm")], "m44-section")
carouselCard = Card([Title("Carousel 容器", "sm"), Carousel([Text("carousel one", "sm"), Text("carousel two", "sm")], 200)])`
